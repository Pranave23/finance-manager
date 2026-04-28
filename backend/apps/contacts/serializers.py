from django.db.models import Count, Q, Sum
from rest_framework import serializers

from apps.contacts.models import Contact
from apps.loans.models import Loan


class ContactSerializer(serializers.ModelSerializer):
    class Meta:
        model = Contact
        fields = (
            "id",
            "name",
            "phone_number",
            "aadhaar_number",
            "type",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")


class ContactDetailSerializer(ContactSerializer):
    loan_summary = serializers.SerializerMethodField()

    class Meta(ContactSerializer.Meta):
        fields = ContactSerializer.Meta.fields + ("loan_summary",)

    def get_loan_summary(self, obj: Contact) -> dict:
        agg = obj.loans.aggregate(
            total_loans=Count("id"),
            active_loans=Count("id", filter=Q(status=Loan.STATUS_ACTIVE)),
            active_principal=Sum(
                "principal_amount", filter=Q(status=Loan.STATUS_ACTIVE)
            ),
        )
        return {
            "total_loans": agg["total_loans"] or 0,
            "active_loans": agg["active_loans"] or 0,
            "active_principal_total": str(agg["active_principal"] or "0.00"),
        }
