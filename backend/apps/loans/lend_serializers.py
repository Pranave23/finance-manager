from decimal import Decimal
import re

from rest_framework import serializers

from apps.loans.lend_calculations import compute_lend_metrics
from apps.loans.models import Borrower, Lend, LendPayment


class BorrowerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Borrower
        fields = (
            "id",
            "name",
            "phone",
            "aadhar_number",
            "email",
            "address",
            "notes",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")

    def validate_aadhar_number(self, value):
        if not value:
            return ""
        digits = re.sub(r"\s+|-", "", value)
        if not re.fullmatch(r"\d{12}", digits):
            raise serializers.ValidationError("Aadhaar number must be exactly 12 digits.")
        return digits


class LendWriteSerializer(serializers.ModelSerializer):
    borrower_id = serializers.PrimaryKeyRelatedField(
        queryset=Borrower.objects.all(), source="borrower", write_only=True
    )

    class Meta:
        model = Lend
        fields = (
            "id",
            "borrower_id",
            "principal_amount",
            "interest_type",
            "interest_rate",
            "rate_period",
            "manual_interest_amount",
            "repayment_schedule_type",
            "lent_date",
            "due_date",
            "collateral_type",
            "collateral_description",
            "collateral_estimated_value",
            "chk_aadhar_verified",
            "chk_mobile_verified",
            "chk_collateral_inspected",
            "chk_collateral_possessed",
            "chk_agreement_signed",
            "chk_security_cheque",
            "chk_collateral_returned",
            "notes",
        )
        read_only_fields = ("id",)
        extra_kwargs = {
            "interest_rate": {"required": False},
            "manual_interest_amount": {"required": False},
            "repayment_schedule_type": {"required": False},
            "collateral_type": {"required": False},
            "collateral_description": {"required": False},
            "collateral_estimated_value": {"required": False},
        }

    def validate_borrower_id(self, borrower):
        request = self.context.get("request")
        if request and borrower.user_id != request.user.id:
            raise serializers.ValidationError("Borrower not found.")
        return borrower

    def validate_principal_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Principal must be greater than 0.")
        return value

    def validate(self, attrs):
        get = lambda key: attrs.get(key, getattr(self.instance, key, None))
        lent, due = get("lent_date"), get("due_date")
        if lent and due and due < lent:
            raise serializers.ValidationError({"due_date": "Due date cannot be before the lent date."})

        interest_type = get("interest_type") or Lend.INTEREST_SIMPLE
        if interest_type == Lend.INTEREST_MANUAL:
            amount = get("manual_interest_amount")
            if amount is None or Decimal(amount) < 0:
                raise serializers.ValidationError({"manual_interest_amount": "Enter the agreed interest amount (0 or more)."})
            if not get("rate_period"):
                attrs["rate_period"] = Lend.PERIOD_OVERALL
            attrs["interest_rate"] = Decimal("0")
        else:
            rate = get("interest_rate")
            if rate is None or Decimal(rate) < 0:
                raise serializers.ValidationError({"interest_rate": "Enter an interest rate (0 or more)."})
            period = get("rate_period")
            if not period or period == Lend.PERIOD_OVERALL:
                raise serializers.ValidationError({"rate_period": "Choose how often the rate applies (day, week, month, or year)."})
            attrs["manual_interest_amount"] = Decimal("0")
        return attrs


class LendChecklistUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Lend
        fields = (
            "chk_aadhar_verified",
            "chk_mobile_verified",
            "chk_collateral_inspected",
            "chk_collateral_possessed",
            "chk_agreement_signed",
            "chk_security_cheque",
            "chk_collateral_returned",
        )


class LendPaymentWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = LendPayment
        fields = ("amount_paid", "payment_date", "notes")

    def validate_amount_paid(self, value):
        if value <= 0:
            raise serializers.ValidationError("Amount must be greater than 0.")
        return value

    def validate_payment_date(self, value):
        lend = self.context["lend"]
        if value < lend.lent_date:
            raise serializers.ValidationError("Payment date cannot be before the lent date.")
        return value

    def create(self, validated_data):
        return LendPayment.objects.create(lend=self.context["lend"], **validated_data)


class LendPaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = LendPayment
        fields = ("id", "payment_date", "amount_paid", "notes")
        read_only_fields = fields


class LendListSerializer(serializers.ModelSerializer):
    borrower = BorrowerSerializer(read_only=True)
    payments = LendPaymentSerializer(many=True, read_only=True)

    class Meta:
        model = Lend
        fields = (
            "id",
            "borrower",
            "principal_amount",
            "interest_type",
            "interest_rate",
            "rate_period",
            "manual_interest_amount",
            "repayment_schedule_type",
            "lent_date",
            "due_date",
            "collateral_type",
            "collateral_description",
            "collateral_estimated_value",
            "chk_aadhar_verified",
            "chk_mobile_verified",
            "chk_collateral_inspected",
            "chk_collateral_possessed",
            "chk_agreement_signed",
            "chk_security_cheque",
            "chk_collateral_returned",
            "notes",
            "created_at",
            "updated_at",
            "payments",
        )

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data.update(compute_lend_metrics(instance))
        return data
