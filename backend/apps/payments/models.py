from django.db import models

from apps.loans.models import Loan
from core.models import BaseModel


class PaymentSchedule(BaseModel):
    STATUS_PENDING = "pending"
    STATUS_PAID = "paid"
    STATUS_OVERDUE = "overdue"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_PAID, "Paid"),
        (STATUS_OVERDUE, "Overdue"),
    ]

    loan = models.ForeignKey(
        Loan, on_delete=models.CASCADE, related_name="payment_schedules"
    )
    due_date = models.DateField()
    amount_due = models.DecimalField(max_digits=14, decimal_places=2)
    principal_due = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    status = models.CharField(
        max_length=16, choices=STATUS_CHOICES, default=STATUS_PENDING
    )
    paid_date = models.DateField(null=True, blank=True)
    overdue_extra_interest = models.DecimalField(
        max_digits=14, decimal_places=2, default=0
    )

    class Meta:
        ordering = ["due_date", "created_at"]

    def __str__(self) -> str:
        return f"Schedule {self.id} — loan {self.loan_id}"


class Payment(BaseModel):
    loan = models.ForeignKey(Loan, on_delete=models.CASCADE, related_name="payments")
    schedule = models.ForeignKey(
        PaymentSchedule,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="payments",
    )
    amount_paid = models.DecimalField(max_digits=14, decimal_places=2)
    paid_on = models.DateField()
    note = models.TextField(blank=True)

    class Meta:
        ordering = ["-paid_on", "-created_at"]

    def __str__(self) -> str:
        return f"Payment {self.id} — {self.amount_paid}"
