from decimal import Decimal

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.loans.lend_calculations import compute_lend_metrics
from apps.loans.lend_serializers import (
    BorrowerSerializer,
    LendChecklistUpdateSerializer,
    LendListSerializer,
    LendPaymentWriteSerializer,
    LendWriteSerializer,
)
from apps.loans.models import Borrower, Lend, LendPayment
from core.mixins import EnvelopeMixin


class BorrowerViewSet(EnvelopeMixin, viewsets.ModelViewSet):
    serializer_class = BorrowerSerializer
    envelope_message = "OK"

    def get_queryset(self):
        return Borrower.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class LendViewSet(EnvelopeMixin, viewsets.ModelViewSet):
    envelope_message = "OK"

    def get_queryset(self):
        return (
            Lend.objects.filter(user=self.request.user)
            .select_related("borrower")
            .prefetch_related("payments")
        )

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return LendWriteSerializer
        return LendListSerializer

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        serializer = LendListSerializer(queryset, many=True)
        return Response(serializer.data)

    def retrieve(self, request, *args, **kwargs):
        lend = self.get_object()
        serializer = LendListSerializer(lend)
        return Response(serializer.data)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        lend = self.get_queryset().get(pk=serializer.instance.pk)
        return Response(LendListSerializer(lend).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        lend = self.get_queryset().get(pk=instance.pk)
        return Response(LendListSerializer(lend).data)

    @action(detail=True, methods=["patch"], url_path="checklist")
    def update_checklist(self, request, pk=None):
        lend = self.get_object()
        serializer = LendChecklistUpdateSerializer(lend, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        refreshed = self.get_queryset().get(pk=lend.pk)
        return Response(LendListSerializer(refreshed).data)

    @action(detail=True, methods=["post"], url_path="payments")
    def add_payment(self, request, pk=None):
        lend = self.get_object()
        payload = {
            "amount_paid": request.data.get("amount_paid"),
            "payment_date": request.data.get("payment_date"),
            "notes": request.data.get("notes", ""),
        }
        serializer = LendPaymentWriteSerializer(data=payload, context={"lend": lend})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        refreshed = self.get_queryset().get(pk=lend.pk)
        return Response(LendListSerializer(refreshed).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["delete"], url_path=r"payments/(?P<payment_id>[^/.]+)")
    def delete_payment(self, request, pk=None, payment_id=None):
        lend = self.get_object()
        LendPayment.objects.filter(lend=lend, pk=payment_id).delete()
        refreshed = self.get_queryset().get(pk=lend.pk)
        return Response(LendListSerializer(refreshed).data)

    @action(detail=False, methods=["get"], url_path="summary")
    def summary(self, request):
        lends = list(self.get_queryset())
        total_lent = Decimal("0")
        total_receivable = Decimal("0")
        total_collected = Decimal("0")
        total_collateral_value = Decimal("0")
        overdue_count = 0

        for lend in lends:
            metrics = compute_lend_metrics(lend)
            total_lent += Decimal(lend.principal_amount)
            total_receivable += metrics["remaining_balance"]
            total_collected += metrics["total_paid"]
            total_collateral_value += Decimal(lend.collateral_estimated_value or 0)
            if metrics["is_overdue"]:
                overdue_count += 1

        return Response({
            "total_lent": total_lent,
            "total_receivable": total_receivable,
            "total_collected": total_collected,
            "total_collateral_value": total_collateral_value,
            "overdue_count": overdue_count,
            "lend_count": len(lends),
        })
