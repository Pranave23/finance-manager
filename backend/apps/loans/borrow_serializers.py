from decimal import Decimal

from rest_framework import serializers

from apps.loans.borrow_calculations import compute_borrow_metrics
from apps.loans.models import Borrow, BorrowPayment, Lender


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


class BorrowPaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = BorrowPayment
        fields = (
            "id",
            "borrow",
            "amount_paid",
            "payment_date",
            "notes",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "borrow", "created_at", "updated_at")


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
            "currency",
            "borrowed_date",
            "due_date",
            "interest_type",
            "interest_rate",
            "rate_period",
            "compounding_frequency",
            "manual_interest_amount",
            "repayment_schedule_type",
            "notes",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        user = self.context.get("request").user if self.context.get("request") else None
        if user and user.is_authenticated:
            self.fields["lender_id"].queryset = Lender.objects.filter(user=user)

    def validate(self, attrs):
        interest_type = attrs.get(
            "interest_type",
            getattr(self.instance, "interest_type", Borrow.INTEREST_NONE),
        )
        interest_rate = attrs.get(
            "interest_rate", getattr(self.instance, "interest_rate", None)
        )
        manual_interest = attrs.get(
            "manual_interest_amount",
            getattr(self.instance, "manual_interest_amount", None),
        )
        compounding = attrs.get(
            "compounding_frequency",
            getattr(self.instance, "compounding_frequency", ""),
        )

        if interest_type in (Borrow.INTEREST_SIMPLE, Borrow.INTEREST_COMPOUND):
            if interest_rate is None:
                raise serializers.ValidationError(
                    {"interest_rate": "Required for Simple and Compound interest."}
                )
        if interest_type == Borrow.INTEREST_COMPOUND and not compounding:
            raise serializers.ValidationError(
                {
                    "compounding_frequency": "Required when interest type is Compound."
                }
            )
        if interest_type == Borrow.INTEREST_MANUAL and manual_interest is None:
            raise serializers.ValidationError(
                {
                    "manual_interest_amount": "Required when interest type is Manual."
                }
            )

        lender = attrs.get("lender") or getattr(self.instance, "lender", None)
        user = self.context.get("request").user if self.context.get("request") else None
        if lender and user and user.is_authenticated and lender.user_id != user.id:
            raise serializers.ValidationError(
                {"lender_id": "Invalid lender for this account."}
            )
        return attrs


class BorrowListSerializer(serializers.ModelSerializer):
    lender = LenderSerializer(read_only=True)
    lender_name = serializers.CharField(source="lender.name", read_only=True)
    lender_phone = serializers.CharField(source="lender.phone", read_only=True)
    accrued_interest = serializers.DecimalField(
        max_digits=14, decimal_places=2, read_only=True
    )
    total_payable_to_date = serializers.DecimalField(
        max_digits=14, decimal_places=2, read_only=True
    )
    total_paid = serializers.DecimalField(
        max_digits=14, decimal_places=2, read_only=True
    )
    remaining_balance = serializers.DecimalField(
        max_digits=14, decimal_places=2, read_only=True
    )
    overpaid_by = serializers.DecimalField(
        max_digits=14, decimal_places=2, read_only=True
    )
    status = serializers.CharField(read_only=True)
    status_label = serializers.CharField(read_only=True)
    next_due_date = serializers.DateField(read_only=True, allow_null=True)
    next_installment_amount = serializers.DecimalField(
        max_digits=14, decimal_places=2, read_only=True
    )
    is_overdue = serializers.BooleanField(read_only=True)
    payments = BorrowPaymentSerializer(many=True, read_only=True)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        metrics = self.context.get("metrics")
        if metrics:
            data.update(metrics)
        return data

    class Meta:
        model = Borrow
        fields = (
            "id",
            "lender",
            "lender_name",
            "lender_phone",
            "principal_amount",
            "currency",
            "borrowed_date",
            "due_date",
            "interest_type",
            "interest_rate",
            "rate_period",
            "compounding_frequency",
            "manual_interest_amount",
            "repayment_schedule_type",
            "notes",
            "accrued_interest",
            "total_payable_to_date",
            "total_paid",
            "remaining_balance",
            "overpaid_by",
            "status",
            "status_label",
            "next_due_date",
            "next_installment_amount",
            "is_overdue",
            "payments",
            "created_at",
            "updated_at",
        )


def annotate_borrow_queryset(queryset):
    return queryset.select_related("lender").prefetch_related("payments")


def serialize_borrow(borrow: Borrow) -> dict:
    payments = list(borrow.payments.all())
    total_paid = sum((Decimal(p.amount_paid) for p in payments), Decimal("0"))
    last_payment_date = None
    if payments:
        last_payment_date = max(p.payment_date for p in payments)
    metrics = compute_borrow_metrics(
        borrow, total_paid, last_payment_date=last_payment_date
    )
    return BorrowListSerializer(borrow, context={"metrics": metrics}).data
