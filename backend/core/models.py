from django.db import models


class Loan(models.Model):
    BORROW = "BORROW"
    LEND = "LEND"
    LOAN_TYPE_CHOICES = [
        (BORROW, "Borrow"),
        (LEND, "Lend"),
    ]

    DAILY = "DAILY"
    WEEKLY = "WEEKLY"
    MONTHLY = "MONTHLY"
    YEARLY = "YEARLY"
    INTEREST_PERIOD_CHOICES = [
        (DAILY, "Daily"),
        (WEEKLY, "Weekly"),
        (MONTHLY, "Monthly"),
        (YEARLY, "Yearly"),
    ]

    name = models.CharField(max_length=100)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    interest_rate = models.DecimalField(max_digits=5, decimal_places=2)
    total_amount = models.DecimalField(max_digits=12, decimal_places=2)
    loan_type = models.CharField(max_length=10, choices=LOAN_TYPE_CHOICES)
    interest_period = models.CharField(
        max_length=10, choices=INTEREST_PERIOD_CHOICES, default=YEARLY
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name