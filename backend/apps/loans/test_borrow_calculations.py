from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.loans.borrow_calculations import compute_borrow_metrics
from apps.loans.models import Borrow, BorrowPayment, Lender

User = get_user_model()
START = date(2025, 1, 1)
ONE_YEAR_LATER = date(2026, 1, 1)  # 365 days == 12 monthly periods


class BorrowCalculationTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="9999999999", password="pw123456")
        self.lender = Lender.objects.create(user=self.user, name="Alice", phone="9876543210")

    def make(self, **kw):
        data = dict(
            user=self.user,
            lender=self.lender,
            principal_amount=Decimal("10000"),
            interest_type=Borrow.INTEREST_SIMPLE,
            interest_rate=Decimal("2"),
            rate_period=Borrow.PERIOD_MONTHLY,
            borrowed_date=START,
            due_date=ONE_YEAR_LATER,
        )
        data.update(kw)
        return Borrow.objects.create(**data)

    def test_simple_estimate(self):
        m = compute_borrow_metrics(self.make(), today=START)
        self.assertEqual(m["estimated_interest_at_due"], Decimal("2400.00"))
        self.assertEqual(m["estimated_total_at_due"], Decimal("12400.00"))
        self.assertEqual(m["interest_per_period"], Decimal("200.00"))
        self.assertEqual(m["tenure_periods"], Decimal("12.00"))

    def test_compound_estimate(self):
        b = self.make(interest_type=Borrow.INTEREST_COMPOUND)
        m = compute_borrow_metrics(b, today=START)
        # 10000 * (1.02^12 - 1) = 2682.42
        self.assertEqual(m["estimated_interest_at_due"], Decimal("2682.42"))
        self.assertEqual(m["estimated_total_at_due"], Decimal("12682.42"))

    def test_yearly_simple(self):
        b = self.make(interest_rate=Decimal("12"), rate_period=Borrow.PERIOD_YEARLY)
        m = compute_borrow_metrics(b, today=START)
        self.assertEqual(m["estimated_interest_at_due"], Decimal("1200.00"))

    def test_manual_overall_is_time_independent(self):
        b = self.make(interest_type=Borrow.INTEREST_MANUAL, interest_rate=0,
                      rate_period=Borrow.PERIOD_OVERALL,
                      manual_interest_amount=Decimal("2000"))
        m = compute_borrow_metrics(b, today=date(2030, 1, 1))
        self.assertEqual(m["estimated_total_at_due"], Decimal("12000.00"))
        self.assertEqual(m["total_payable_to_date"], Decimal("12000.00"))
        self.assertIsNone(m["interest_per_period"])

    def test_manual_per_period(self):
        b = self.make(interest_type=Borrow.INTEREST_MANUAL, interest_rate=0,
                      rate_period=Borrow.PERIOD_MONTHLY,
                      manual_interest_amount=Decimal("500"))
        m = compute_borrow_metrics(b, today=START)
        # 500 per month * 12 months = 6000
        self.assertEqual(m["estimated_interest_at_due"], Decimal("6000.00"))
        self.assertEqual(m["estimated_total_at_due"], Decimal("16000.00"))
        self.assertEqual(m["interest_per_period"], Decimal("500.00"))

    def test_open_ended_has_no_estimate_but_accrues(self):
        b = self.make(due_date=None)
        m = compute_borrow_metrics(b, today=ONE_YEAR_LATER)
        self.assertIsNone(m["estimated_total_at_due"])
        self.assertEqual(m["accrued_interest"], Decimal("2400.00"))
        self.assertFalse(m["is_overdue"])

    def test_partial_and_overdue(self):
        b = self.make()
        BorrowPayment.objects.create(borrow=b, payment_date=date(2025, 6, 1), amount_paid=Decimal("5000"))
        m = compute_borrow_metrics(b, today=date(2026, 1, 11))
        self.assertEqual(m["status"], "Partial")
        self.assertTrue(m["is_overdue"])
        self.assertEqual(m["days_overdue"], 10)

    def test_interest_stops_after_settlement(self):
        b = self.make()
        BorrowPayment.objects.create(borrow=b, payment_date=ONE_YEAR_LATER, amount_paid=Decimal("12400"))
        m = compute_borrow_metrics(b, today=date(2027, 1, 1))
        self.assertEqual(m["status"], "Paid")
        self.assertEqual(m["remaining_balance"], Decimal("0.00"))
        self.assertEqual(m["settled_on"], ONE_YEAR_LATER)
        self.assertFalse(m["is_overdue"])

    def test_overpayment(self):
        b = self.make(interest_type=Borrow.INTEREST_MANUAL, interest_rate=0,
                      manual_interest_amount=Decimal("0"), principal_amount=Decimal("1000"))
        BorrowPayment.objects.create(borrow=b, payment_date=START, amount_paid=Decimal("1200"))
        m = compute_borrow_metrics(b, today=START)
        self.assertEqual(m["status"], "Paid")
        self.assertEqual(m["overpaid_by"], Decimal("200.00"))

    def test_promised_schedule_and_early_late_tracking(self):
        # 10,000 at 2%/month simple for 1 year (12400 total, 12 monthly installments of 1033.33)
        b = self.make(repayment_schedule_type=Borrow.SCHEDULE_MONTHLY)
        m1 = compute_borrow_metrics(b, today=date(2025, 1, 15))
        self.assertEqual(m1["total_scheduled_installments"], 12)
        self.assertEqual(m1["installments_completed"], 0)
        self.assertEqual(m1["next_payment_date"], date(2025, 2, 1))
        self.assertEqual(m1["next_payment_amount"], Decimal("1033.33"))
        self.assertEqual(m1["schedule_status"], "on_track")
        self.assertGreater(m1["early_savings"], Decimal("0"))

        # Pay 1st installment early on Jan 20 -> advances next_payment_date to Mar 1
        BorrowPayment.objects.create(borrow=b, payment_date=date(2025, 1, 20), amount_paid=Decimal("1033.33"))
        m2 = compute_borrow_metrics(b, today=date(2025, 1, 20))
        self.assertEqual(m2["installments_completed"], 1)
        self.assertEqual(m2["next_payment_date"], date(2025, 3, 1))
        self.assertEqual(m2["schedule_status"], "early")

        # If still unpaid by Mar 10 -> late on 2nd installment
        m3 = compute_borrow_metrics(b, today=date(2025, 3, 10))
        self.assertEqual(m3["schedule_status"], "late")
        self.assertEqual(m3["schedule_days_diff"], 9)

        # If past final due date -> late_extra_interest > 0
        m4 = compute_borrow_metrics(b, today=date(2026, 2, 1))
        self.assertGreater(m4["late_extra_interest"], Decimal("0"))
        self.assertGreater(m4["projected_final_total"], Decimal("12400.00"))


class BorrowApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="8888888888", password="pw123456")
        self.lender = Lender.objects.create(user=self.user, name="Bob", phone="1")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def payload(self, **kw):
        data = {
            "lender_id": str(self.lender.id),
            "principal_amount": "10000",
            "interest_type": "simple",
            "interest_rate": "2",
            "rate_period": "monthly",
            "borrowed_date": "2025-01-01",
            "due_date": "2026-01-01",
        }
        data.update(kw)
        return data

    def test_create_and_pay(self):
        res = self.client.post("/api/v1/borrow/", self.payload(), format="json")
        self.assertEqual(res.status_code, 201, res.content)
        body = res.json()
        body = body.get("data", body)
        self.assertEqual(Decimal(str(body["estimated_total_at_due"])), Decimal("12400"))

        res = self.client.post(f"/api/v1/borrow/{body['id']}/payments/",
                               {"amount_paid": "1000", "payment_date": "2025-02-01"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        body = res.json()
        body = body.get("data", body)
        self.assertEqual(Decimal(str(body["total_paid"])), Decimal("1000"))

    def test_due_before_borrowed_rejected(self):
        res = self.client.post("/api/v1/borrow/", self.payload(due_date="2024-01-01"), format="json")
        self.assertEqual(res.status_code, 400)

    def test_manual_requires_amount(self):
        res = self.client.post("/api/v1/borrow/", self.payload(interest_type="manual"), format="json")
        self.assertEqual(res.status_code, 400)
