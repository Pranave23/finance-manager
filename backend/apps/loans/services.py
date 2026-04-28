import calendar
from datetime import date, timedelta
from decimal import Decimal

from apps.loans.models import Loan
from apps.payments.models import PaymentSchedule


def simple_interest_for_periods(
    principal: Decimal, rate_percent: Decimal, periods: Decimal
) -> Decimal:
    """SI = (P × R × T) / 100"""
    return (principal * rate_percent * periods) / Decimal("100")


def simple_interest_one_period(principal: Decimal, rate_percent: Decimal) -> Decimal:
    return simple_interest_for_periods(principal, rate_percent, Decimal("1"))


def _add_one_month(d: date) -> date:
    month = d.month + 1
    year = d.year
    if month > 12:
        month = 1
        year += 1
    last_day = calendar.monthrange(year, month)[1]
    day = min(d.day, last_day)
    return date(year, month, day)


def add_interest_period(start: date, interest_period: str) -> date:
    if interest_period == Loan.PERIOD_DAILY:
        return start + timedelta(days=1)
    if interest_period == Loan.PERIOD_WEEKLY:
        return start + timedelta(weeks=1)
    if interest_period == Loan.PERIOD_MONTHLY:
        return _add_one_month(start)
    raise ValueError(f"Unsupported interest period: {interest_period!r}")


def generate_payment_schedules_for_loan(loan: Loan, count: int = 12) -> list[PaymentSchedule]:
    """
    Create `count` future PaymentSchedule rows, one period apart.
    First due date = loan.start_date + 1 period.
    """
    schedules: list[PaymentSchedule] = []
    period_start = loan.start_date
    amount_due = simple_interest_one_period(loan.principal_amount, loan.interest_rate)

    for _ in range(count):
        due = add_interest_period(period_start, loan.interest_period)
        period_start = due
        schedules.append(
            PaymentSchedule(
                loan=loan,
                due_date=due,
                amount_due=amount_due,
                principal_due=Decimal("0"),
                status=PaymentSchedule.STATUS_PENDING,
            )
        )

    return PaymentSchedule.objects.bulk_create(schedules)
