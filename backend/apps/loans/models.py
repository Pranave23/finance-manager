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
    INTEREST_SIMPLE = "simple"
    INTEREST_COMPOUND = "compound"
    INTEREST_MANUAL = "manual"
    INTEREST_CHOICES = [
        (INTEREST_SIMPLE, "Simple"),
        (INTEREST_COMPOUND, "Compound"),
        (INTEREST_MANUAL, "Manual (fixed amount)"),
    ]

    PERIOD_DAILY = "daily"
    PERIOD_WEEKLY = "weekly"
    PERIOD_MONTHLY = "monthly"
    PERIOD_YEARLY = "yearly"
    PERIOD_OVERALL = "overall"
    PERIOD_CHOICES = [
        (PERIOD_DAILY, "Daily"),
        (PERIOD_WEEKLY, "Weekly"),
        (PERIOD_MONTHLY, "Monthly"),
        (PERIOD_YEARLY, "Yearly"),
        (PERIOD_OVERALL, "Overall (One-time)"),
    ]

    SCHEDULE_DAILY = "daily"
    SCHEDULE_WEEKLY = "weekly"
    SCHEDULE_MONTHLY = "monthly"
    SCHEDULE_YEARLY = "yearly"
    SCHEDULE_ONE_TIME = "one_time"
    SCHEDULE_CHOICES = [
        (SCHEDULE_DAILY, "Daily"),
        (SCHEDULE_WEEKLY, "Weekly"),
        (SCHEDULE_MONTHLY, "Monthly"),
        (SCHEDULE_YEARLY, "Yearly"),
        (SCHEDULE_ONE_TIME, "One-time (on due date)"),
    ]

    user = models.ForeignKey(
        "auth.User", on_delete=models.CASCADE, related_name="borrows"
    )
    lender = models.ForeignKey(
        Lender, on_delete=models.PROTECT, related_name="borrows"
    )
    principal_amount = models.DecimalField(max_digits=14, decimal_places=2)
    interest_type = models.CharField(
        max_length=16, choices=INTEREST_CHOICES, default=INTEREST_SIMPLE
    )
    # Percentage per rate_period (2 = 2%). Used by simple / compound.
    interest_rate = models.DecimalField(max_digits=7, decimal_places=4, default=0)
    rate_period = models.CharField(
        max_length=16, choices=PERIOD_CHOICES, default=PERIOD_MONTHLY
    )
    # Flat rupee interest for the whole loan or per rate_period. Used by manual only.
    manual_interest_amount = models.DecimalField(
        max_digits=14, decimal_places=2, default=0
    )
    repayment_schedule_type = models.CharField(
        max_length=16, choices=SCHEDULE_CHOICES, default=SCHEDULE_MONTHLY
    )
    borrowed_date = models.DateField()
    due_date = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-borrowed_date", "-created_at"]

    def __str__(self) -> str:
        return f"Borrow — {self.lender.name} — {self.principal_amount}"


class BorrowPayment(BaseModel):
    borrow = models.ForeignKey(
        Borrow, on_delete=models.CASCADE, related_name="payments"
    )
    payment_date = models.DateField()
    amount_paid = models.DecimalField(max_digits=14, decimal_places=2)
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-payment_date", "-created_at"]

    def __str__(self) -> str:
        return f"Payment {self.id} — {self.amount_paid}"


class Borrower(BaseModel):
    user = models.ForeignKey(
        "auth.User", on_delete=models.CASCADE, related_name="borrowers"
    )
    name = models.CharField(max_length=255)
    phone = models.CharField(max_length=32)
    aadhar_number = models.CharField(max_length=16, blank=True, default="")
    email = models.EmailField(blank=True, default="")
    address = models.TextField(blank=True, default="")
    notes = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["name", "-created_at"]

    def __str__(self) -> str:
        return self.name


class Lend(BaseModel):
    INTEREST_SIMPLE = "simple"
    INTEREST_COMPOUND = "compound"
    INTEREST_MANUAL = "manual"
    INTEREST_CHOICES = Borrow.INTEREST_CHOICES

    PERIOD_DAILY = "daily"
    PERIOD_WEEKLY = "weekly"
    PERIOD_MONTHLY = "monthly"
    PERIOD_YEARLY = "yearly"
    PERIOD_OVERALL = "overall"
    PERIOD_CHOICES = Borrow.PERIOD_CHOICES

    SCHEDULE_DAILY = "daily"
    SCHEDULE_WEEKLY = "weekly"
    SCHEDULE_MONTHLY = "monthly"
    SCHEDULE_YEARLY = "yearly"
    SCHEDULE_ONE_TIME = "one_time"
    SCHEDULE_CHOICES = Borrow.SCHEDULE_CHOICES

    COLLATERAL_NONE = "none"
    COLLATERAL_GOLD = "gold"
    COLLATERAL_VEHICLE = "vehicle"
    COLLATERAL_PROPERTY = "property"
    COLLATERAL_ELECTRONICS = "electronics"
    COLLATERAL_CHEQUE = "cheque"
    COLLATERAL_OTHER = "other"
    COLLATERAL_CHOICES = [
        (COLLATERAL_NONE, "Unsecured (No Collateral)"),
        (COLLATERAL_GOLD, "Gold / Jewellery"),
        (COLLATERAL_VEHICLE, "Vehicle (2W / 4W + RC)"),
        (COLLATERAL_PROPERTY, "Property / Land Title Deed"),
        (COLLATERAL_ELECTRONICS, "Electronics / Machinery"),
        (COLLATERAL_CHEQUE, "Post-Dated Cheque / Promissory Note"),
        (COLLATERAL_OTHER, "Other Asset"),
    ]

    user = models.ForeignKey(
        "auth.User", on_delete=models.CASCADE, related_name="lends"
    )
    borrower = models.ForeignKey(
        Borrower, on_delete=models.PROTECT, related_name="lends"
    )
    principal_amount = models.DecimalField(max_digits=14, decimal_places=2)
    interest_type = models.CharField(
        max_length=16, choices=INTEREST_CHOICES, default=INTEREST_SIMPLE
    )
    interest_rate = models.DecimalField(max_digits=7, decimal_places=4, default=0)
    rate_period = models.CharField(
        max_length=16, choices=PERIOD_CHOICES, default=PERIOD_MONTHLY
    )
    manual_interest_amount = models.DecimalField(
        max_digits=14, decimal_places=2, default=0
    )
    repayment_schedule_type = models.CharField(
        max_length=16, choices=SCHEDULE_CHOICES, default=SCHEDULE_MONTHLY
    )
    lent_date = models.DateField()
    due_date = models.DateField(null=True, blank=True)

    # Collateral details
    collateral_type = models.CharField(
        max_length=24, choices=COLLATERAL_CHOICES, default=COLLATERAL_NONE
    )
    collateral_description = models.TextField(blank=True, default="")
    collateral_estimated_value = models.DecimalField(
        max_digits=14, decimal_places=2, default=0
    )

    # KYC, Collateral & Legal Verification Checklist
    chk_aadhar_verified = models.BooleanField(default=False)
    chk_mobile_verified = models.BooleanField(default=False)
    chk_collateral_inspected = models.BooleanField(default=False)
    chk_collateral_possessed = models.BooleanField(default=False)
    chk_agreement_signed = models.BooleanField(default=False)
    chk_security_cheque = models.BooleanField(default=False)
    chk_collateral_returned = models.BooleanField(default=False)

    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-lent_date", "-created_at"]

    def __str__(self) -> str:
        return f"Lend — {self.borrower.name} — {self.principal_amount}"


class LendPayment(BaseModel):
    lend = models.ForeignKey(
        Lend, on_delete=models.CASCADE, related_name="payments"
    )
    payment_date = models.DateField()
    amount_paid = models.DecimalField(max_digits=14, decimal_places=2)
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-payment_date", "-created_at"]

    def __str__(self) -> str:
        return f"LendPayment {self.id} — {self.amount_paid}"
