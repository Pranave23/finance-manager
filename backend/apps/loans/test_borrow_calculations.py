from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase

from apps.loans.borrow_calculations import compute_borrow_metrics
from apps.loans.models import Borrow, BorrowPayment, Lender

User = get_user_model()


class BorrowCalculationTests(TestCase):
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

    def test_simple_interest_calculation(self):
        # 10,000 borrowed 30 days ago at 10% monthly
        borrowed_date = date.today() - timedelta(days=30)
        borrow = Borrow.objects.create(
            user=self.user,
            lender=self.lender,
            principal_amount=Decimal("10000.00"),
            currency="INR",
            borrowed_date=borrowed_date,
            due_date=date.today() + timedelta(days=30),
            interest_type=Borrow.INTEREST_SIMPLE,
            interest_rate=Decimal("10.00"),
            rate_period=Borrow.PERIOD_MONTHLY,
            repayment_schedule_type=Borrow.SCHEDULE_MONTHLY,
        )

        metrics = compute_borrow_metrics(borrow, total_paid=Decimal("0"))
        self.assertGreater(metrics["accrued_interest"], Decimal("900.00"))
        self.assertLess(metrics["accrued_interest"], Decimal("1100.00"))
        self.assertEqual(metrics["status"], "Unpaid")
        self.assertFalse(metrics["is_overdue"])

    def test_compound_interest_calculation(self):
        # 10,000 borrowed 365 days ago at 12% yearly compounded monthly
        borrowed_date = date.today() - timedelta(days=365)
        borrow = Borrow.objects.create(
            user=self.user,
            lender=self.lender,
            principal_amount=Decimal("10000.00"),
            currency="INR",
            borrowed_date=borrowed_date,
            interest_type=Borrow.INTEREST_COMPOUND,
            interest_rate=Decimal("12.00"),
            rate_period=Borrow.PERIOD_YEARLY,
            compounding_frequency=Borrow.PERIOD_MONTHLY,
            repayment_schedule_type=Borrow.SCHEDULE_ONE_TIME,
        )

        metrics = compute_borrow_metrics(borrow, total_paid=Decimal("0"))
        # (1 + 0.12/12)^12 - 1 = 12.68% -> approx 1,268 interest
        self.assertGreater(metrics["accrued_interest"], Decimal("1200.00"))
        self.assertLess(metrics["accrued_interest"], Decimal("1300.00"))

    def test_manual_and_none_interest(self):
        borrow_manual = Borrow.objects.create(
            user=self.user,
            lender=self.lender,
            principal_amount=Decimal("5000.00"),
            borrowed_date=date.today() - timedelta(days=10),
            interest_type=Borrow.INTEREST_MANUAL,
            manual_interest_amount=Decimal("250.00"),
        )
        m_metrics = compute_borrow_metrics(borrow_manual, total_paid=Decimal("0"))
        self.assertEqual(m_metrics["accrued_interest"], Decimal("250.00"))
        self.assertEqual(m_metrics["total_payable_to_date"], Decimal("5250.00"))

        borrow_none = Borrow.objects.create(
            user=self.user,
            lender=self.lender,
            principal_amount=Decimal("5000.00"),
            borrowed_date=date.today() - timedelta(days=10),
            interest_type=Borrow.INTEREST_NONE,
        )
        n_metrics = compute_borrow_metrics(borrow_none, total_paid=Decimal("0"))
        self.assertEqual(n_metrics["accrued_interest"], Decimal("0.00"))
        self.assertEqual(n_metrics["total_payable_to_date"], Decimal("5000.00"))

    def test_overpayment_and_overdue_flags(self):
        past_due = date.today() - timedelta(days=5)
        borrow = Borrow.objects.create(
            user=self.user,
            lender=self.lender,
            principal_amount=Decimal("2000.00"),
            borrowed_date=date.today() - timedelta(days=20),
            due_date=past_due,
            interest_type=Borrow.INTEREST_NONE,
        )

        # Unpaid & overdue
        metrics1 = compute_borrow_metrics(borrow, total_paid=Decimal("0"))
        self.assertEqual(metrics1["status"], "Unpaid")
        self.assertTrue(metrics1["is_overdue"])

        # Partial payment
        metrics2 = compute_borrow_metrics(borrow, total_paid=Decimal("1000.00"))
        self.assertEqual(metrics2["status"], "Partial")
        self.assertEqual(metrics2["remaining_balance"], Decimal("1000.00"))
        self.assertTrue(metrics2["is_overdue"])

        # Overpaid by 500
        metrics3 = compute_borrow_metrics(borrow, total_paid=Decimal("2500.00"))
        self.assertEqual(metrics3["status"], "Paid")
        self.assertEqual(metrics3["remaining_balance"], Decimal("0.00"))
        self.assertEqual(metrics3["overpaid_by"], Decimal("500.00"))
        self.assertIn("overpaid by 500.00", metrics3["status_label"])
        self.assertFalse(metrics3["is_overdue"])
