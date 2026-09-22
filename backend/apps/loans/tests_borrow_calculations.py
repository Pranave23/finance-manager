from datetime import date
from decimal import Decimal

from django.test import SimpleTestCase

from apps.loans.borrow_calculations import accrued_interest, compute_borrow_metrics
from apps.loans.models import Borrow, Lender


def _borrow(**kwargs):
    defaults = {
        "borrowed_date": date(2024, 1, 1),
        "principal_amount": Decimal("10000"),
        "interest_type": Borrow.INTEREST_NONE,
        "rate_period": Borrow.PERIOD_MONTHLY,
        "repayment_schedule_type": Borrow.SCHEDULE_ONE_TIME,
    }
    defaults.update(kwargs)
    lender = Lender(name="Test", phone="1")
    return Borrow(lender=lender, **defaults)


class BorrowCalculationTests(SimpleTestCase):
    def test_none_interest_is_zero(self):
        borrow = _borrow(interest_type=Borrow.INTEREST_NONE)
        self.assertEqual(accrued_interest(borrow, date(2025, 1, 1)), Decimal("0"))

    def test_manual_interest(self):
        borrow = _borrow(
            interest_type=Borrow.INTEREST_MANUAL,
            manual_interest_amount=Decimal("500"),
        )
        self.assertEqual(accrued_interest(borrow, date(2025, 1, 1)), Decimal("500"))

    def test_simple_interest(self):
        borrow = _borrow(
            interest_type=Borrow.INTEREST_SIMPLE,
            interest_rate=Decimal("12"),
            rate_period=Borrow.PERIOD_YEARLY,
        )
        interest = accrued_interest(borrow, date(2025, 1, 1))
        self.assertGreater(interest, Decimal("0"))

    def test_overpayment_status(self):
        borrow = _borrow(
            interest_type=Borrow.INTEREST_MANUAL,
            manual_interest_amount=Decimal("100"),
        )
        metrics = compute_borrow_metrics(borrow, Decimal("10200"), last_payment_date=None)
        self.assertEqual(metrics["remaining_balance"], Decimal("0"))
        self.assertEqual(metrics["overpaid_by"], Decimal("100"))
        self.assertIn("overpaid", metrics["status_label"])
