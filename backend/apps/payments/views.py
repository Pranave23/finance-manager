from rest_framework import status
from rest_framework.generics import get_object_or_404
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework import viewsets

from apps.payments.models import Payment, PaymentSchedule
from apps.payments.serializers import (
    MarkSchedulePaidSerializer,
    PaymentSerializer,
)
from apps.payments.services import (
    mark_schedule_overdue,
    mark_schedule_paid,
    scan_and_mark_overdue_schedules,
)
from core.mixins import EnvelopeMixin


class PaymentViewSet(EnvelopeMixin, viewsets.ModelViewSet):
    queryset = Payment.objects.select_related("loan", "schedule").all()
    serializer_class = PaymentSerializer
    http_method_names = ["get", "post", "head", "options"]
    envelope_message = "OK"

    def get_queryset(self):
        qs = super().get_queryset()
        loan_id = self.request.query_params.get("loan")
        if loan_id:
            qs = qs.filter(loan_id=loan_id)
        return qs


class ScheduleMarkPaidView(EnvelopeMixin, APIView):
    envelope_message = "Schedule marked as paid"

    def patch(self, request, pk):
        schedule = get_object_or_404(PaymentSchedule.objects.select_related("loan"), pk=pk)
        ser = MarkSchedulePaidSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        mark_schedule_paid(schedule, ser.validated_data["paid_date"])
        return Response(
            {
                "id": str(schedule.id),
                "status": schedule.status,
                "paid_date": schedule.paid_date,
            }
        )


class ScheduleMarkOverdueView(EnvelopeMixin, APIView):
    envelope_message = "Schedule marked as overdue"

    def patch(self, request, pk):
        schedule = get_object_or_404(PaymentSchedule.objects.select_related("loan"), pk=pk)
        mark_schedule_overdue(schedule)
        return Response(
            {
                "id": str(schedule.id),
                "status": schedule.status,
                "overdue_extra_interest": str(schedule.overdue_extra_interest),
            }
        )


class ScheduleCheckOverdueView(EnvelopeMixin, APIView):
    envelope_message = "Overdue scan complete"

    def get(self, request):
        count = scan_and_mark_overdue_schedules()
        return Response({"schedules_updated": count})
