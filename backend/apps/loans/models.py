from django.db import models

from apps.contacts.models import Contact
from core.models import BaseModel


class Loan(BaseModel):
    DIRECTION_LENDING = "lending"
    DIRECTION_BORROWING = "borrowing"
    DIRECTION_CHOICES = [
        (DIRECTION_LENDING, "Lending"),
        (DIRECTION_BORROWING, "Borrowing"),
    ]

    PERIOD_DAILY = "daily"
    PERIOD_WEEKLY = "weekly"
    PERIOD_MONTHLY = "monthly"
    PERIOD_CHOICES = [
        (PERIOD_DAILY, "Daily"),
        (PERIOD_WEEKLY, "Weekly"),
        (PERIOD_MONTHLY, "Monthly"),
    ]

    STATUS_ACTIVE = "active"
    STATUS_CLOSED = "closed"
    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_CLOSED, "Closed"),
    ]

    contact = models.ForeignKey(
        Contact, on_delete=models.CASCADE, related_name="loans"
    )
    direction = models.CharField(max_length=16, choices=DIRECTION_CHOICES)
    principal_amount = models.DecimalField(max_digits=14, decimal_places=2)
    interest_rate = models.DecimalField(max_digits=7, decimal_places=4)
    interest_period = models.CharField(max_length=16, choices=PERIOD_CHOICES)
    start_date = models.DateField()
    status = models.CharField(
        max_length=16, choices=STATUS_CHOICES, default=STATUS_ACTIVE
    )
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-start_date", "-created_at"]

    def __str__(self) -> str:
        return f"Loan {self.id} — {self.contact.name}"


class BorrowLend(BaseModel):
    TYPE_BORROW = "borrow"
    TYPE_LEND = "lend"
    TYPE_CHOICES = [
        (TYPE_BORROW, "Borrow"),
        (TYPE_LEND, "Lend"),
    ]

    STATUS_PENDING = "Pending"
    STATUS_RETURNED = "Returned"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_RETURNED, "Returned"),
    ]

    user = models.ForeignKey(
        "auth.User", on_delete=models.CASCADE, related_name="borrow_lend_records"
    )
    person_name = models.CharField(max_length=255)
    phone_number = models.CharField(max_length=32, blank=True, default="")
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    due_date = models.DateField()
    notes = models.TextField(blank=True, default="")
    status = models.CharField(
        max_length=16, choices=STATUS_CHOICES, default=STATUS_PENDING
    )
    type = models.CharField(max_length=16, choices=TYPE_CHOICES)

    class Meta:
        ordering = ["-due_date", "-created_at"]

    def __str__(self) -> str:
        return f"{self.type.capitalize()} — {self.person_name} — ₹{self.amount}"


class Lender(BaseModel):
    user = models.ForeignKey(
        "auth.User", on_delete=models.CASCADE, related_name="lenders"
    )
    name = models.CharField(max_length=255)
    phone = models.CharField(max_length=32)
    email = models.EmailField(blank=True, default="")
    notes = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["name", "-created_at"]

    def __str__(self) -> str:
        return self.name


class Borrow(BaseModel):
    INTEREST_SIMPLE = "Simple"
    INTEREST_COMPOUND = "Compound"
    INTEREST_MANUAL = "Manual"
    INTEREST_NONE = "None"
    INTEREST_TYPE_CHOICES = [
        (INTEREST_SIMPLE, "Simple"),
        (INTEREST_COMPOUND, "Compound"),
        (INTEREST_MANUAL, "Manual"),
        (INTEREST_NONE, "None"),
    ]

    PERIOD_DAILY = "daily"
    PERIOD_WEEKLY = "weekly"
    PERIOD_MONTHLY = "monthly"
    PERIOD_YEARLY = "yearly"
    PERIOD_CHOICES = [
        (PERIOD_DAILY, "Daily"),
        (PERIOD_WEEKLY, "Weekly"),
        (PERIOD_MONTHLY, "Monthly"),
        (PERIOD_YEARLY, "Yearly"),
    ]

    SCHEDULE_ONE_TIME = "one_time"
    SCHEDULE_MONTHLY = "monthly"
    SCHEDULE_WEEKLY = "weekly"
    SCHEDULE_DAILY = "daily"
    SCHEDULE_CHOICES = [
        (SCHEDULE_ONE_TIME, "One time"),
        (SCHEDULE_MONTHLY, "Monthly"),
        (SCHEDULE_WEEKLY, "Weekly"),
        (SCHEDULE_DAILY, "Daily"),
    ]

    user = models.ForeignKey(
        "auth.User", on_delete=models.CASCADE, related_name="borrows"
    )
    lender = models.ForeignKey(
        Lender, on_delete=models.PROTECT, related_name="borrows"
    )
    principal_amount = models.DecimalField(max_digits=14, decimal_places=2)
    currency = models.CharField(max_length=8, default="INR")
    borrowed_date = models.DateField()
    due_date = models.DateField(null=True, blank=True)
    interest_type = models.CharField(
        max_length=16, choices=INTEREST_TYPE_CHOICES, default=INTEREST_NONE
    )
    interest_rate = models.DecimalField(
        max_digits=7, decimal_places=4, null=True, blank=True
    )
    rate_period = models.CharField(
        max_length=16, choices=PERIOD_CHOICES, default=PERIOD_MONTHLY
    )
    compounding_frequency = models.CharField(
        max_length=16, choices=PERIOD_CHOICES, blank=True, default=""
    )
    manual_interest_amount = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True
    )
    repayment_schedule_type = models.CharField(
        max_length=16, choices=SCHEDULE_CHOICES, default=SCHEDULE_ONE_TIME
    )
    notes = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-borrowed_date", "-created_at"]

    def __str__(self) -> str:
        return f"Borrow — {self.lender.name} — {self.principal_amount}"


class BorrowPayment(BaseModel):
    borrow = models.ForeignKey(
        Borrow, on_delete=models.CASCADE, related_name="payments"
    )
    amount_paid = models.DecimalField(max_digits=14, decimal_places=2)
    payment_date = models.DateField()
    notes = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-payment_date", "-created_at"]

    def __str__(self) -> str:
        return f"Payment {self.id} — {self.amount_paid}"

