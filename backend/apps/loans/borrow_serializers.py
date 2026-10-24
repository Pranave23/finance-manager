from decimal import Decimal, ROUND_HALF_UP
from django.db.models import Sum
from rest_framework import serializers

from apps.loans.models import Borrow, BorrowPayment, Lender
from apps.loans.borrow_calculations import compute_fixed_principal_metrics


class LenderSerializer(serializers.ModelSerializer):
    class Meta:
        model = Lender
        fields = (
            "id",
            "name",
            "phone",
            "email",
            "notes",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")


class BorrowWriteSerializer(serializers.ModelSerializer):
    lender_id = serializers.PrimaryKeyRelatedField(queryset=Lender.objects.all(), source="lender", write_only=True)

    class Meta:
        model = Borrow
        fields = (
            "id",
            "lender_id",
            "principal_amount",
            "interest_rate",
            "rate_period",
            "number_of_installments",
            "borrowed_date",
            "due_date",
            "notes",
        )
        read_only_fields = ("id",)

    def validate_number_of_installments(self, value):
        if value < 1:
            raise serializers.ValidationError("number_of_installments must be at least 1")
        return value

    def create(self, validated_data):
        principal = Decimal(validated_data["principal_amount"]).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        installments = validated_data["number_of_installments"]
        fixed = (principal / installments).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        validated_data["fixed_principal_installment"] = fixed
        return super().create(validated_data)

    def update(self, instance, validated_data):
        principal_changed = "principal_amount" in validated_data
        installments_changed = "number_of_installments" in validated_data
        if principal_changed or installments_changed:
            principal = Decimal(validated_data.get("principal_amount", instance.principal_amount)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            installments = validated_data.get("number_of_installments", instance.number_of_installments)
            fixed = (principal / installments).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            validated_data["fixed_principal_installment"] = fixed
        return super().update(instance, validated_data)


class BorrowPaymentWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = BorrowPayment
        fields = ("amount_paid", "payment_date", "notes")

    def validate_amount_paid(self, value):
        if value <= 0:
            raise serializers.ValidationError("amount_paid must be greater than 0")
        return value

    def create(self, validated_data):
        borrow = self.context["borrow"]
        # Compute remaining principal before this payment
        agg = borrow.payments.aggregate(total_principal=Sum('principal_component'))
        total_principal_paid = agg['total_principal'] or Decimal('0')
        remaining_before = Decimal(borrow.principal_amount) - total_principal_paid
        remaining_before = remaining_before.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        rate_per_period = Decimal(borrow.interest_rate) / Decimal('100') if borrow.interest_rate else Decimal('0')
        # Interest component
        interest = (remaining_before * rate_per_period).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        # Principal component
        amount = Decimal(validated_data["amount_paid"]).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        principal_component = amount - interest
        interest_shortfall = False
        overpayment_amount = Decimal('0')
        if principal_component < 0:
            interest_shortfall = True
            principal_component = Decimal('0')
        if principal_component > remaining_before:
            overpayment_amount = principal_component - remaining_before
            principal_component = remaining_before
        remaining_after = remaining_before - principal_component
        payment = BorrowPayment.objects.create(
            borrow=borrow,
            amount_paid=amount,
            payment_date=validated_data["payment_date"],
            notes=validated_data.get("notes", ""),
            interest_component=interest,
            principal_component=principal_component,
            remaining_principal_after=remaining_after,
            interest_shortfall=interest_shortfall,
            overpayment_amount=overpayment_amount,
        )
        return payment


class BorrowPaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = BorrowPayment
        fields = (
            "id",
            "payment_date",
            "amount_paid",
            "interest_component",
            "principal_component",
            "remaining_principal_after",
            "interest_shortfall",
            "overpayment_amount",
            "notes",
        )
        read_only_fields = ("id",)


class BorrowListSerializer(serializers.ModelSerializer):
    lender = LenderSerializer(read_only=True)
    payments = BorrowPaymentSerializer(many=True, read_only=True)
    total_paid = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    total_interest_paid = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    total_principal_paid = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    remaining_balance = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    status = serializers.CharField(read_only=True)
    is_overdue = serializers.BooleanField(read_only=True)
    current_period_interest_due = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    suggested_next_payment = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)

    class Meta:
        model = Borrow
        fields = (
            "id",
            "lender",
            "principal_amount",
            "interest_rate",
            "rate_period",
            "number_of_installments",
            "fixed_principal_installment",
            "borrowed_date",
            "due_date",
            "notes",
            "created_at",
            "updated_at",
            "total_paid",
            "total_interest_paid",
            "total_principal_paid",
            "remaining_balance",
            "status",
            "is_overdue",
            "current_period_interest_due",
            "suggested_next_payment",
            "payments",
        )

    def to_representation(self, instance):
        data = super().to_representation(instance)
        derived = compute_fixed_principal_metrics(instance)
        data.update(derived)
        return data
