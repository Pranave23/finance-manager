"""Borrow interest & repayment schedule calculations.

All money values are Decimal, rounded to 2 places. Nothing here is stored;
everything is derived on read from the Borrow row and its payments.

Interest types
--------------
simple   : interest = P x r x t            (always on the original principal)
compound : interest = P x ((1 + r)^t - 1)  (interest added to balance every period)
manual   : interest = fixed rupee amount agreed with the lender (per period or overall)

where r = interest_rate / 100 per rate_period and t = elapsed time in rate_periods.
"""
import calendar
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
import math

from apps.loans.models import Borrow

ZERO = Decimal("0")
CENT = Decimal("0.01")

# Length of one rate period in days. Monthly uses the average month (365/12)
# so 12 monthly periods == 1 year exactly.
PERIOD_DAYS = {
    Borrow.PERIOD_DAILY: Decimal("1"),
    Borrow.PERIOD_WEEKLY: Decimal("7"),
    Borrow.PERIOD_MONTHLY: Decimal("365") / Decimal("12"),
    Borrow.PERIOD_YEARLY: Decimal("365"),
}


def q(value) -> Decimal:
    return Decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)


def add_schedule_periods(start: date, schedule_type: str, count: int) -> date:
    """Advance `start` by `count` schedule periods (calendar-accurate for months/years)."""
    if count <= 0:
        return start
    if schedule_type == Borrow.SCHEDULE_DAILY:
        return start + timedelta(days=count)
    if schedule_type == Borrow.SCHEDULE_WEEKLY:
        return start + timedelta(days=7 * count)
    if schedule_type == Borrow.SCHEDULE_YEARLY:
        try:
            return start.replace(year=start.year + count)
        except ValueError:
            return start.replace(year=start.year + count, day=28)
    # Default: monthly
    total_months = (start.month - 1) + count
    year = start.year + total_months // 12
    month = total_months % 12 + 1
    max_day = calendar.monthrange(year, month)[1]
    return date(year, month, min(start.day, max_day))


def periods_between(borrow: Borrow, start: date, end: date) -> Decimal:
    days = max((end - start).days, 0)
    return Decimal(days) / PERIOD_DAYS.get(borrow.rate_period, PERIOD_DAYS[Borrow.PERIOD_MONTHLY])


def interest_until(borrow: Borrow, end: date) -> Decimal:
    """Interest owed from borrowed_date up to `end` (no payments considered)."""
    principal = Decimal(borrow.principal_amount)
    if borrow.interest_type == Borrow.INTEREST_MANUAL:
        manual_amt = Decimal(borrow.manual_interest_amount or ZERO)
        if manual_amt <= 0:
            return ZERO
        if borrow.rate_period == Borrow.PERIOD_OVERALL or not borrow.rate_period:
            return q(manual_amt)
        t = periods_between(borrow, borrow.borrowed_date, end)
        return q(manual_amt * t)

    rate = Decimal(borrow.interest_rate or ZERO) / Decimal("100")
    if rate <= 0:
        return ZERO
    t = periods_between(borrow, borrow.borrowed_date, end)

    if borrow.interest_type == Borrow.INTEREST_COMPOUND:
        growth = Decimal(str((1 + float(rate)) ** float(t)))
        return q(principal * (growth - 1))
    return q(principal * rate * t)


def _settled_date(borrow: Borrow, payments) -> date | None:
    """First payment date on which cumulative payments cleared principal + interest.

    Used to stop interest accruing once the loan is fully repaid.
    """
    paid = ZERO
    principal = Decimal(borrow.principal_amount)
    for p in sorted(payments, key=lambda x: (x.payment_date, x.created_at)):
        paid += Decimal(p.amount_paid)
        if paid >= principal + interest_until(borrow, p.payment_date):
            return p.payment_date
    return None


def _schedule_period_interest(borrow: Borrow, sched: str) -> Decimal:
    """Estimated interest for a single repayment schedule period."""
    principal = Decimal(borrow.principal_amount)
    sched_days = PERIOD_DAYS.get(sched, PERIOD_DAYS[Borrow.PERIOD_MONTHLY])
    rate_days = PERIOD_DAYS.get(borrow.rate_period, PERIOD_DAYS[Borrow.PERIOD_MONTHLY])
    ratio = sched_days / rate_days

    if borrow.interest_type == Borrow.INTEREST_MANUAL:
        if borrow.rate_period == Borrow.PERIOD_OVERALL:
            return ZERO
        return q(Decimal(borrow.manual_interest_amount or ZERO) * ratio)

    rate = Decimal(borrow.interest_rate or ZERO) / Decimal("100")
    if rate <= 0:
        return ZERO
    if borrow.interest_type == Borrow.INTEREST_COMPOUND:
        growth = Decimal(str((1 + float(rate)) ** float(ratio)))
        return q(principal * (growth - 1))
    return q(principal * rate * ratio)


def compute_borrow_metrics(borrow: Borrow, today: date | None = None) -> dict:
    today = today or date.today()
    principal = q(borrow.principal_amount)
    payments = list(borrow.payments.all())
    total_paid = q(sum((Decimal(p.amount_paid) for p in payments), ZERO))

    # --- Estimate: everything paid exactly on the due date, nothing late ---
    tenure_periods = None
    estimated_interest = None
    estimated_total = None
    if borrow.due_date:
        if borrow.interest_type == Borrow.INTEREST_MANUAL and borrow.rate_period == Borrow.PERIOD_OVERALL:
            tenure_periods = None
        else:
            tenure_periods = periods_between(borrow, borrow.borrowed_date, borrow.due_date)
        estimated_interest = interest_until(borrow, borrow.due_date)
        estimated_total = q(principal + estimated_interest)
    elif borrow.interest_type == Borrow.INTEREST_MANUAL and borrow.rate_period == Borrow.PERIOD_OVERALL:
        estimated_interest = q(borrow.manual_interest_amount or ZERO)
        estimated_total = q(principal + estimated_interest)

    # --- Actuals to date (accrual stops once the loan is settled) ---
    settled_on = _settled_date(borrow, payments)
    accrual_end = settled_on or today
    accrued_interest = interest_until(borrow, accrual_end)
    total_payable_to_date = q(principal + accrued_interest)

    remaining = total_payable_to_date - total_paid
    overpaid_by = q(-remaining) if remaining < 0 else ZERO
    remaining_balance = q(max(remaining, ZERO))

    if remaining_balance <= 0 and total_paid > 0:
        status = "Paid"
    elif total_paid > 0:
        status = "Partial"
    else:
        status = "Unpaid"

    is_overdue = bool(borrow.due_date and today > borrow.due_date and status != "Paid")
    days_overdue = (today - borrow.due_date).days if is_overdue else 0

    # Interest for one rate_period on the original principal.
    if borrow.interest_type == Borrow.INTEREST_MANUAL:
        interest_per_period = (
            None
            if borrow.rate_period == Borrow.PERIOD_OVERALL
            else q(borrow.manual_interest_amount or ZERO)
        )
    else:
        rate = Decimal(borrow.interest_rate or ZERO) / Decimal("100")
        interest_per_period = q(principal * rate)

    # --- Promised next payment & early/late schedule tracking ---
    sched = borrow.repayment_schedule_type or Borrow.SCHEDULE_MONTHLY
    total_scheduled_installments = None
    installments_completed = 0
    next_payment_date = None
    next_payment_amount = None
    schedule_status = "settled" if status == "Paid" else "on_track"
    schedule_days_diff = 0
    projected_final_total = total_paid if status == "Paid" else (estimated_total or total_payable_to_date)
    late_extra_interest = ZERO
    early_savings = ZERO

    if status != "Paid":
        if sched == Borrow.SCHEDULE_ONE_TIME:
            total_scheduled_installments = 1 if borrow.due_date else None
            next_payment_date = borrow.due_date
            base_target = estimated_total if estimated_total is not None else total_payable_to_date
            next_payment_amount = q(max(base_target - total_paid, remaining_balance))
        else:
            sched_days = PERIOD_DAYS.get(sched, PERIOD_DAYS[Borrow.PERIOD_MONTHLY])
            if borrow.due_date:
                total_days = max((borrow.due_date - borrow.borrowed_date).days, 1)
                n_total = max(1, math.ceil(float(Decimal(total_days) / sched_days) - 1e-9))
                total_scheduled_installments = n_total
                target_total = estimated_total if estimated_total is not None else total_payable_to_date
                regular_installment = q(target_total / Decimal(n_total))

                if regular_installment > 0:
                    installments_completed = min(int(total_paid // regular_installment), n_total - 1)
                next_k = installments_completed + 1
                cand_date = add_schedule_periods(borrow.borrowed_date, sched, next_k)
                if cand_date > borrow.due_date:
                    cand_date = borrow.due_date
                next_payment_date = cand_date

                cumulative_target = min(regular_installment * Decimal(next_k), target_total)
                needed_for_milestone = q(max(cumulative_target - total_paid, ZERO))
                remaining_if_on_time = q(max(target_total - total_paid, ZERO))
                next_payment_amount = min(
                    needed_for_milestone if needed_for_milestone > 0 else regular_installment,
                    remaining_if_on_time,
                )
            else:
                # Open-ended loan with recurring schedule
                per_sched_int = _schedule_period_interest(borrow, sched)
                regular_installment = per_sched_int if per_sched_int > 0 else q(principal * Decimal("0.10"))
                installments_completed = len(payments)
                next_k = installments_completed + 1
                next_payment_date = add_schedule_periods(borrow.borrowed_date, sched, next_k)
                next_payment_amount = min(
                    regular_installment if regular_installment > 0 else remaining_balance,
                    remaining_balance,
                )

        # Determine early / on_track / due_soon / late relative to next_payment_date
        if next_payment_date:
            diff = (today - next_payment_date).days
            schedule_days_diff = diff
            if diff > 0:
                schedule_status = "late"
                if is_overdue:
                    next_payment_amount = remaining_balance
            elif diff >= -3:
                schedule_status = "due_soon"
            elif installments_completed > 0:
                prev_due = add_schedule_periods(borrow.borrowed_date, sched, installments_completed)
                if today <= prev_due:
                    schedule_status = "early"

        # Projected final total if settled today vs on due date (or late accrual)
        if borrow.due_date and estimated_total is not None:
            if today > borrow.due_date:
                projected_final_total = total_payable_to_date
                late_extra_interest = q(max(total_payable_to_date - estimated_total, ZERO))
            else:
                # If settled early today, total cost is total_payable_to_date
                early_savings = q(max(estimated_total - total_payable_to_date, ZERO))
                projected_final_total = estimated_total
    else:
        # Already settled: check whether they saved money by paying early or paid extra due to late
        if borrow.due_date and estimated_total is not None:
            if total_payable_to_date < estimated_total:
                early_savings = q(estimated_total - total_payable_to_date)
                schedule_status = "settled_early"
            elif total_payable_to_date > estimated_total:
                late_extra_interest = q(total_payable_to_date - estimated_total)
                schedule_status = "settled_late"
            projected_final_total = total_payable_to_date

    return {
        "repayment_schedule_type": sched,
        "tenure_periods": q(tenure_periods) if tenure_periods is not None else None,
        "estimated_interest_at_due": estimated_interest,
        "estimated_total_at_due": estimated_total,
        "interest_per_period": interest_per_period,
        "accrued_interest": accrued_interest,
        "total_payable_to_date": total_payable_to_date,
        "total_paid": total_paid,
        "remaining_balance": remaining_balance,
        "overpaid_by": overpaid_by,
        "status": status,
        "is_overdue": is_overdue,
        "days_overdue": days_overdue,
        "settled_on": settled_on,
        "total_scheduled_installments": total_scheduled_installments,
        "installments_completed": installments_completed,
        "next_payment_date": next_payment_date,
        "next_payment_amount": next_payment_amount,
        "schedule_status": schedule_status,
        "schedule_days_diff": schedule_days_diff,
        "projected_final_total": projected_final_total,
        "late_extra_interest": late_extra_interest,
        "early_savings": early_savings,
    }
