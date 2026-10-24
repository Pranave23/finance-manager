from decimal import Decimal

from rest_framework import serializers

from apps.loans.borrow_calculations import compute_borrow_metrics
from apps.loans.models import Borrow, BorrowPayment, Lender


class LenderSerializer(serializers.ModelSerializer):
    class Meta:
        model = Lender
        fields = ("id", "name", "phone", "email", "notes", "created_at", "updated_at")
        read_only_fields = ("id", "created_at", "updated_at")


class BorrowWriteSerializer(serializers.ModelSerializer):
    lender_id = serializers.PrimaryKeyRelatedField(
        queryset=Lender.objects.all(), source="lender", write_only=True
    )

    class Meta:
        model = Borrow
        fields = (
            "id",
            "lender_id",
            "principal_amount",
            "interest_type",
            "interest_rate",
            "rate_period",
            "manual_interest_amount",
            "repayment_schedule_type",
            "borrowed_date",
            "due_date",
            "notes",
        )
        read_only_fields = ("id",)
        extra_kwargs = {
            "interest_rate": {"required": False},
            "manual_interest_amount": {"required": False},
            "repayment_schedule_type": {"required": False},
        }

    def validate_lender_id(self, lender):
        request = self.context.get("request")
        if request and lender.user_id != request.user.id:
            raise serializers.ValidationError("Lender not found.")
        return lender

    def validate_principal_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Principal must be greater than 0.")
        return value

    def validate(self, attrs):
        get = lambda key: attrs.get(key, getattr(self.instance, key, None))
        borrowed, due = get("borrowed_date"), get("due_date")
        if borrowed and due and due < borrowed:
            raise serializers.ValidationError({"due_date": "Due date cannot be before the borrowed date."})

        interest_type = get("interest_type") or Borrow.INTEREST_SIMPLE
        if interest_type == Borrow.INTEREST_MANUAL:
            amount = get("manual_interest_amount")
            if amount is None or Decimal(amount) < 0:
                raise serializers.ValidationError({"manual_interest_amount": "Enter the agreed interest amount (0 or more)."})
            if not get("rate_period"):
                attrs["rate_period"] = Borrow.PERIOD_OVERALL
            attrs["interest_rate"] = Decimal("0")
        else:
            rate = get("interest_rate")
            if rate is None or Decimal(rate) < 0:
                raise serializers.ValidationError({"interest_rate": "Enter an interest rate (0 or more)."})
            period = get("rate_period")
            if not period or period == Borrow.PERIOD_OVERALL:
                raise serializers.ValidationError({"rate_period": "Choose how often the rate applies (day, week, month, or year)."})
            attrs["manual_interest_amount"] = Decimal("0")
        return attrs


class BorrowPaymentWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = BorrowPayment
        fields = ("amount_paid", "payment_date", "notes")

    def validate_amount_paid(self, value):
        if value <= 0:
            raise serializers.ValidationError("Amount must be greater than 0.")
        return value

    def validate_payment_date(self, value):
        borrow = self.context["borrow"]
        if value < borrow.borrowed_date:
            raise serializers.ValidationError("Payment date cannot be before the borrowed date.")
        return value

    def create(self, validated_data):
        return BorrowPayment.objects.create(borrow=self.context["borrow"], **validated_data)


class BorrowPaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = BorrowPayment
        fields = ("id", "payment_date", "amount_paid", "notes")
        read_only_fields = fields


class BorrowListSerializer(serializers.ModelSerializer):
    lender = LenderSerializer(read_only=True)
    payments = BorrowPaymentSerializer(many=True, read_only=True)

    class Meta:
        model = Borrow
        fields = (
            "id",
            "lender",
            "principal_amount",
            "interest_type",
            "interest_rate",
            "rate_period",
            "manual_interest_amount",
            "repayment_schedule_type",
            "borrowed_date",
            "due_date",
            "notes",
            "created_at",
            "updated_at",
            "payments",
        )

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data.update(compute_borrow_metrics(instance))
        return data
