from rest_framework import serializers

from apps.payments.models import Payment, PaymentSchedule


class PaymentScheduleSerializer(serializers.ModelSerializer):
    class Meta:
        model = PaymentSchedule
        fields = (
            "id",
            "loan",
            "due_date",
            "amount_due",
            "principal_due",
            "status",
            "paid_date",
            "overdue_extra_interest",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "loan",
            "amount_due",
            "principal_due",
            "status",
            "paid_date",
            "overdue_extra_interest",
            "created_at",
            "updated_at",
        )


class MarkSchedulePaidSerializer(serializers.Serializer):
    paid_date = serializers.DateField()


class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = (
            "id",
            "loan",
            "schedule",
            "amount_paid",
            "paid_on",
            "note",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")
