from rest_framework import serializers

from apps.contacts.serializers import ContactSerializer
from apps.loans.models import Loan
from apps.payments.serializers import PaymentScheduleSerializer


class LoanSerializer(serializers.ModelSerializer):
    class Meta:
        model = Loan
        fields = (
            "id",
            "contact",
            "direction",
            "principal_amount",
            "interest_rate",
            "interest_period",
            "start_date",
            "status",
            "notes",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "status", "created_at", "updated_at")

class LoanStatusSerializer(serializers.ModelSerializer):
    class Meta:
        model = Loan
        fields = ("status",)


class LoanDetailSerializer(LoanSerializer):
    contact = ContactSerializer(read_only=True)
    payment_schedules = PaymentScheduleSerializer(many=True, read_only=True)

    class Meta(LoanSerializer.Meta):
        fields = LoanSerializer.Meta.fields + ("payment_schedules",)
