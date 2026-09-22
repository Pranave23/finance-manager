from decimal import Decimal

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.loans.borrow_calculations import compute_borrow_metrics
from apps.loans.borrow_serializers import (
    BorrowListSerializer,
    BorrowPaymentSerializer,
    BorrowWriteSerializer,
    LenderSerializer,
    annotate_borrow_queryset,
    serialize_borrow,
)
from apps.loans.models import Borrow, BorrowPayment, Lender
from core.mixins import EnvelopeMixin


class LenderViewSet(EnvelopeMixin, viewsets.ModelViewSet):
    serializer_class = LenderSerializer
    envelope_message = "OK"

    def get_queryset(self):
        return Lender.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class BorrowViewSet(EnvelopeMixin, viewsets.ModelViewSet):
    envelope_message = "OK"

    def get_queryset(self):
        return annotate_borrow_queryset(
            Borrow.objects.filter(user=self.request.user)
        )

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return BorrowWriteSerializer
        return BorrowListSerializer

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        data = [serialize_borrow(b) for b in queryset]
        return Response(data)

    def retrieve(self, request, *args, **kwargs):
        borrow = self.get_object()
        return Response(serialize_borrow(borrow))

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        borrow = annotate_borrow_queryset(
            Borrow.objects.filter(pk=serializer.instance.pk)
        ).get()
        return Response(serialize_borrow(borrow), status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        borrow = annotate_borrow_queryset(
            Borrow.objects.filter(pk=instance.pk)
        ).get()
        return Response(serialize_borrow(borrow))

    @action(detail=True, methods=["post"], url_path="payments")
    def add_payment(self, request, pk=None):
        borrow = self.get_object()
        payload = {
            "amount_paid": request.data.get("amount_paid"),
            "payment_date": request.data.get("payment_date"),
            "notes": request.data.get("notes", ""),
        }
        serializer = BorrowPaymentSerializer(data=payload)
        serializer.is_valid(raise_exception=True)
        payment = BorrowPayment.objects.create(
            borrow=borrow,
            amount_paid=serializer.validated_data["amount_paid"],
            payment_date=serializer.validated_data["payment_date"],
            notes=serializer.validated_data.get("notes", ""),
        )
        borrow = annotate_borrow_queryset(
            Borrow.objects.filter(pk=borrow.pk)
        ).get()
        result = serialize_borrow(borrow)
        result["last_payment"] = BorrowPaymentSerializer(payment).data
        return Response(result, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["delete"], url_path=r"payments/(?P<payment_id>[^/.]+)")
    def delete_payment(self, request, pk=None, payment_id=None):
        borrow = self.get_object()
        BorrowPayment.objects.filter(borrow=borrow, pk=payment_id).delete()
        borrow = annotate_borrow_queryset(
            Borrow.objects.filter(pk=borrow.pk)
        ).get()
        return Response(serialize_borrow(borrow))

    @action(detail=False, methods=["get"], url_path="summary")
    def summary(self, request):
        borrows = list(self.get_queryset())
        total_borrowed = Decimal("0")
        total_outstanding = Decimal("0")
        total_paid = Decimal("0")
        overdue_count = 0

        for borrow in borrows:
            payments = list(borrow.payments.all())
            paid = sum((Decimal(p.amount_paid) for p in payments), Decimal("0"))
            last_payment_date = (
                max(p.payment_date for p in payments) if payments else None
            )
            metrics = compute_borrow_metrics(
                borrow, paid, last_payment_date=last_payment_date
            )
            total_borrowed += Decimal(borrow.principal_amount)
            total_outstanding += metrics["remaining_balance"]
            total_paid += metrics["total_paid"]
            if metrics["is_overdue"]:
                overdue_count += 1

        return Response(
            {
                "total_borrowed": total_borrowed,
                "total_outstanding": total_outstanding,
                "total_paid": total_paid,
                "overdue_count": overdue_count,
                "borrow_count": len(borrows),
            }
        )
