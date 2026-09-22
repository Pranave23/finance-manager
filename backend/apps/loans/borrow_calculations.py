import calendar
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from apps.loans.models import Borrow


def _quantize(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"))


def periods_between(start: date, end: date, period: str) -> Decimal:
    if end < start:
        return Decimal("0")
    days = Decimal((end - start).days)
    if period == Borrow.PERIOD_DAILY:
        return days
    if period == Borrow.PERIOD_WEEKLY:
        return days / Decimal("7")
    if period == Borrow.PERIOD_MONTHLY:
        return days / Decimal("30.4375")
    if period == Borrow.PERIOD_YEARLY:
        return days / Decimal("365.25")
    raise ValueError(f"Unsupported period: {period!r}")


def periods_per_year(period: str) -> Decimal:
    mapping = {
        Borrow.PERIOD_DAILY: Decimal("365.25"),
        Borrow.PERIOD_WEEKLY: Decimal("52"),
        Borrow.PERIOD_MONTHLY: Decimal("12"),
        Borrow.PERIOD_YEARLY: Decimal("1"),
    }
    return mapping.get(period, Decimal("1"))


def compounding_periods_per_year(frequency: str) -> Decimal:
    mapping = {
        Borrow.PERIOD_DAILY: Decimal("365.25"),
        Borrow.PERIOD_WEEKLY: Decimal("52"),
        Borrow.PERIOD_MONTHLY: Decimal("12"),
        Borrow.PERIOD_YEARLY: Decimal("1"),
    }
    return mapping.get(frequency, Decimal("1"))


def accrued_interest(borrow: Borrow, as_of: date | None = None) -> Decimal:
    as_of = as_of or date.today()
    principal = Decimal(borrow.principal_amount)

    if borrow.interest_type == Borrow.INTEREST_NONE:
        return Decimal("0")

    if borrow.interest_type == Borrow.INTEREST_MANUAL:
        return Decimal(borrow.manual_interest_amount or 0)

    if borrow.interest_type == Borrow.INTEREST_SIMPLE:
        if not borrow.interest_rate:
            return Decimal("0")
        periods = periods_between(borrow.borrowed_date, as_of, borrow.rate_period)
        rate = Decimal(borrow.interest_rate) / Decimal("100")
        return _quantize(principal * rate * periods)

    if borrow.interest_type == Borrow.INTEREST_COMPOUND:
        if not borrow.interest_rate or not borrow.compounding_frequency:
            return Decimal("0")
        freq = compounding_periods_per_year(borrow.compounding_frequency)
        years = periods_between(borrow.borrowed_date, as_of, Borrow.PERIOD_YEARLY)
        rate_annual = (
            Decimal(borrow.interest_rate) / Decimal("100")
        ) * periods_per_year(borrow.rate_period)
        per_period_rate = rate_annual / freq
        exponent = freq * years
        if exponent <= 0:
            return Decimal("0")
        factor = (Decimal("1") + per_period_rate) ** exponent
        return _quantize(principal * factor - principal)

    return Decimal("0")


def interest_for_one_period(borrow: Borrow, principal_basis: Decimal | None = None) -> Decimal:
    basis = principal_basis if principal_basis is not None else Decimal(borrow.principal_amount)

    if borrow.interest_type in (Borrow.INTEREST_NONE, Borrow.INTEREST_MANUAL):
        return Decimal("0")

    if borrow.interest_type == Borrow.INTEREST_SIMPLE and borrow.interest_rate:
        rate = Decimal(borrow.interest_rate) / Decimal("100")
        return _quantize(basis * rate)

    if (
        borrow.interest_type == Borrow.INTEREST_COMPOUND
        and borrow.interest_rate
        and borrow.compounding_frequency
    ):
        freq = compounding_periods_per_year(borrow.compounding_frequency)
        rate_annual = (
            Decimal(borrow.interest_rate) / Decimal("100")
        ) * periods_per_year(borrow.rate_period)
        per_period_rate = rate_annual / freq
        return _quantize(basis * per_period_rate)

    return Decimal("0")


def _add_one_month(d: date) -> date:
    month = d.month + 1
    year = d.year
    if month > 12:
        month = 1
        year += 1
    last_day = calendar.monthrange(year, month)[1]
    day = min(d.day, last_day)
    return date(year, month, day)


def add_schedule_period(start: date, schedule_type: str) -> date:
    if schedule_type == Borrow.SCHEDULE_DAILY:
        return start + timedelta(days=1)
    if schedule_type == Borrow.SCHEDULE_WEEKLY:
        return start + timedelta(weeks=1)
    if schedule_type == Borrow.SCHEDULE_MONTHLY:
        return _add_one_month(start)
    if schedule_type == Borrow.SCHEDULE_ONE_TIME:
        return start
    raise ValueError(f"Unsupported schedule: {schedule_type!r}")


def compute_borrow_metrics(
    borrow: Borrow,
    total_paid: Decimal,
    as_of: date | None = None,
    last_payment_date: date | None = None,
) -> dict[str, Any]:
    as_of = as_of or date.today()
    principal = Decimal(borrow.principal_amount)
    interest = accrued_interest(borrow, as_of)
    total_payable = _quantize(principal + interest)
    total_paid = _quantize(total_paid)

    raw_remaining = total_payable - total_paid
    overpaid_by = Decimal("0")
    if raw_remaining < 0:
        overpaid_by = _quantize(-raw_remaining)
        remaining_balance = Decimal("0")
    else:
        remaining_balance = _quantize(raw_remaining)

    if remaining_balance <= 0 and total_paid > 0:
        status = "Paid"
    elif total_paid > 0:
        status = "Partial"
    else:
        status = "Unpaid"

    status_label = status
    if overpaid_by > 0:
        status_label = f"Paid (overpaid by {overpaid_by})"

    anchor = last_payment_date or borrow.borrowed_date
    if remaining_balance <= 0:
        next_due_date = None
        next_installment_amount = Decimal("0")
    elif borrow.repayment_schedule_type == Borrow.SCHEDULE_ONE_TIME:
        next_due_date = borrow.due_date
        next_installment_amount = remaining_balance
    else:
        next_due = add_schedule_period(anchor, borrow.repayment_schedule_type)
        while next_due < as_of:
            next_due = add_schedule_period(next_due, borrow.repayment_schedule_type)
        next_due_date = next_due

        period_interest = interest_for_one_period(borrow, principal)
        if period_interest > 0:
            next_installment_amount = _quantize(
                min(remaining_balance, period_interest)
            )
        else:
            next_installment_amount = _quantize(remaining_balance)

    is_overdue = (
        borrow.due_date is not None
        and borrow.due_date < as_of
        and status != "Paid"
    )

    return {
        "accrued_interest": interest,
        "total_payable_to_date": total_payable,
        "total_paid": total_paid,
        "remaining_balance": remaining_balance,
        "overpaid_by": overpaid_by,
        "status": status,
        "status_label": status_label,
        "next_due_date": next_due_date,
        "next_installment_amount": next_installment_amount,
        "is_overdue": is_overdue,
        "principal_amount": principal,
    }
