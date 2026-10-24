from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase

from apps.loans.borrow_calculations import compute_fixed_principal_metrics
from apps.loans.models import Borrow, BorrowPayment, Lender

User = get_user_model()


class FixedPrincipalBorrowTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="9999999999", password="password123"
        )
        self.lender = Lender.objects.create(
            user=self.user,
            name="Alice",
            phone="9876543210",
            email="alice@example.com",
            notes="Friend",
        )

    def _create_borrow(self, **kwargs):
        defaults = {
            "user": self.user,
            "lender": self.lender,
            "principal_amount": Decimal("10000.00"),
            "interest_rate": Decimal("2.0000"),  # 2% per period
            "rate_period": "monthly",
            "number_of_installments": 10,
            "borrowed_date": date.today() - timedelta(days=30),
        }
        defaults.update(kwargs)
        # fixed_principal_installment is computed on save
        defaults.setdefault(
            "fixed_principal_installment",
            Decimal(defaults["principal_amount"]) / Decimal(defaults["number_of_installments"]),
        )
        return Borrow.objects.create(**defaults)

    def test_borrow_creation_fixed_installment(self):
        """fixed_principal_installment = principal / number_of_installments"""
        borrow = self._create_borrow(
            principal_amount=Decimal("10000.00"),
            number_of_installments=4,
            fixed_principal_installment=Decimal("2500.00"),
        )
        self.assertEqual(borrow.fixed_principal_installment, Decimal("2500.00"))

    def test_unpaid_status_no_payments(self):
        borrow = self._create_borrow()
        metrics = compute_fixed_principal_metrics(borrow)
        self.assertEqual(metrics["status"], "Unpaid")
        self.assertEqual(metrics["total_paid"], Decimal("0.00"))
        self.assertEqual(metrics["remaining_balance"], Decimal("10000.00"))

    def test_partial_payment(self):
        borrow = self._create_borrow()
        # First payment: interest = 10000 * 0.02 = 200, principal = 1200 - 200 = 1000
        BorrowPayment.objects.create(
            borrow=borrow,
            payment_date=date.today(),
            amount_paid=Decimal("1200.00"),
            interest_component=Decimal("200.00"),
            principal_component=Decimal("1000.00"),
            remaining_principal_after=Decimal("9000.00"),
        )
        metrics = compute_fixed_principal_metrics(borrow)
        self.assertEqual(metrics["status"], "Partial")
        self.assertEqual(metrics["total_paid"], Decimal("1200.00"))
        self.assertEqual(metrics["total_principal_paid"], Decimal("1000.00"))
        self.assertEqual(metrics["total_interest_paid"], Decimal("200.00"))
        self.assertEqual(metrics["remaining_balance"], Decimal("9000.00"))

    def test_fully_paid_status(self):
        borrow = self._create_borrow(
            principal_amount=Decimal("1000.00"),
            number_of_installments=1,
            fixed_principal_installment=Decimal("1000.00"),
            interest_rate=Decimal("5.0000"),
        )
        # Single payment covers everything: interest = 1000 * 0.05 = 50
        BorrowPayment.objects.create(
            borrow=borrow,
            payment_date=date.today(),
            amount_paid=Decimal("1050.00"),
            interest_component=Decimal("50.00"),
            principal_component=Decimal("1000.00"),
            remaining_principal_after=Decimal("0.00"),
        )
        metrics = compute_fixed_principal_metrics(borrow)
        self.assertEqual(metrics["status"], "Paid")
        self.assertEqual(metrics["remaining_balance"], Decimal("0.00"))

    def test_overdue_detection(self):
        borrow = self._create_borrow(
            due_date=date.today() - timedelta(days=5),  # past due
        )
        metrics = compute_fixed_principal_metrics(borrow)
        self.assertTrue(metrics["is_overdue"])

    def test_not_overdue_when_paid(self):
        borrow = self._create_borrow(
            principal_amount=Decimal("500.00"),
            number_of_installments=1,
            fixed_principal_installment=Decimal("500.00"),
            interest_rate=Decimal("0.0000"),
            due_date=date.today() - timedelta(days=5),
        )
        BorrowPayment.objects.create(
            borrow=borrow,
            payment_date=date.today(),
            amount_paid=Decimal("500.00"),
            interest_component=Decimal("0.00"),
            principal_component=Decimal("500.00"),
            remaining_principal_after=Decimal("0.00"),
        )
        metrics = compute_fixed_principal_metrics(borrow)
        self.assertEqual(metrics["status"], "Paid")
        self.assertFalse(metrics["is_overdue"])

    def test_not_overdue_when_no_due_date(self):
        borrow = self._create_borrow(due_date=None)
        metrics = compute_fixed_principal_metrics(borrow)
        self.assertFalse(metrics["is_overdue"])

    def test_suggested_next_payment(self):
        borrow = self._create_borrow(
            principal_amount=Decimal("10000.00"),
            number_of_installments=10,
            fixed_principal_installment=Decimal("1000.00"),
            interest_rate=Decimal("2.0000"),
        )
        metrics = compute_fixed_principal_metrics(borrow)
        # suggested = fixed_principal (1000) + interest_due (10000 * 0.02 = 200) = 1200
        self.assertEqual(metrics["suggested_next_payment"], Decimal("1200.00"))

    def test_suggested_payment_caps_at_remaining(self):
        """When remaining balance < fixed installment, use remaining instead."""
        borrow = self._create_borrow(
            principal_amount=Decimal("1000.00"),
            number_of_installments=2,
            fixed_principal_installment=Decimal("500.00"),
            interest_rate=Decimal("2.0000"),
        )
        # Pay down 800 of principal, leaving 200
        BorrowPayment.objects.create(
            borrow=borrow,
            payment_date=date.today(),
            amount_paid=Decimal("820.00"),
            interest_component=Decimal("20.00"),
            principal_component=Decimal("800.00"),
            remaining_principal_after=Decimal("200.00"),
        )
        metrics = compute_fixed_principal_metrics(borrow)
        # remaining = 200 < fixed 500, so principal_component = 200
        # interest = 200 * 0.02 = 4
        # suggested = 200 + 4 = 204
        self.assertEqual(metrics["suggested_next_payment"], Decimal("204.00"))
        self.assertEqual(metrics["remaining_balance"], Decimal("200.00"))

    def test_zero_interest_rate(self):
        borrow = self._create_borrow(
            interest_rate=Decimal("0.0000"),
            number_of_installments=5,
            fixed_principal_installment=Decimal("2000.00"),
        )
        metrics = compute_fixed_principal_metrics(borrow)
        self.assertEqual(metrics["current_period_interest_due"], Decimal("0.00"))
        self.assertEqual(metrics["suggested_next_payment"], Decimal("2000.00"))
