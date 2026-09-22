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

