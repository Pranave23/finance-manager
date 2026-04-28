from django.db import transaction
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.loans.models import Loan
from apps.loans.serializers import (
    LoanDetailSerializer,
    LoanSerializer,
    LoanStatusSerializer,
)
from apps.loans.services import generate_payment_schedules_for_loan
from apps.payments.serializers import PaymentScheduleSerializer
from core.mixins import EnvelopeMixin


class LoanViewSet(
    EnvelopeMixin,
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    mixins.ListModelMixin,
    viewsets.GenericViewSet,
):
    queryset = Loan.objects.select_related("contact").prefetch_related(
        "payment_schedules"
    )
    envelope_message = "OK"

    def get_serializer_class(self):
        if self.action == "retrieve":
            return LoanDetailSerializer
        if self.action == "update_status":
            return LoanStatusSerializer
        return LoanSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        contact_id = self.request.query_params.get("contact")
        if contact_id:
            qs = qs.filter(contact_id=contact_id)
        return qs

    def perform_create(self, serializer):
        with transaction.atomic():
            loan = serializer.save()
            generate_payment_schedules_for_loan(loan)

    @action(detail=True, methods=["get"], url_path="schedule")
    def schedule(self, request, pk=None):
        loan = self.get_object()
        serializer = PaymentScheduleSerializer(
            loan.payment_schedules.all(), many=True
        )
        return Response(serializer.data)

    @action(
        detail=True,
        methods=["patch"],
        url_path="status",
        url_name="loan-status",
    )
    def update_status(self, request, pk=None):
        loan = self.get_object()
        serializer = LoanStatusSerializer(loan, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        detail = LoanDetailSerializer(
            Loan.objects.prefetch_related("payment_schedules").select_related(
                "contact"
            ).get(pk=loan.pk)
        )
        return Response(detail.data, status=status.HTTP_200_OK)
