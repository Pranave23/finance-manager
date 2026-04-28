from datetime import date
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from apps.payments.models import PaymentSchedule


def _as_date(value: date | None = None) -> date:
    if value is not None:
        return value
    return timezone.localdate()


def overdue_extra_interest(
    amount_due: Decimal, rate_percent: Decimal, days_overdue: int
) -> Decimal:
    if days_overdue <= 0:
        return Decimal("0")
    return (amount_due * rate_percent * Decimal(days_overdue)) / Decimal("100")


def recalculate_overdue_extra_interest(
    schedule: PaymentSchedule, as_of: date | None = None
) -> PaymentSchedule:
    as_of_d = _as_date(as_of)
    loan = schedule.loan
    days_overdue = (as_of_d - schedule.due_date).days
    schedule.overdue_extra_interest = overdue_extra_interest(
        schedule.amount_due, loan.interest_rate, days_overdue
    )
    return schedule


def mark_schedule_overdue(
    schedule: PaymentSchedule, as_of: date | None = None
) -> PaymentSchedule:
    as_of_d = _as_date(as_of)
    schedule.status = PaymentSchedule.STATUS_OVERDUE
    recalculate_overdue_extra_interest(schedule, as_of_d)
    schedule.save(
        update_fields=["status", "overdue_extra_interest", "updated_at"]
    )
    return schedule


def mark_schedule_paid(
    schedule: PaymentSchedule, paid_date: date
) -> PaymentSchedule:
    schedule.status = PaymentSchedule.STATUS_PAID
    schedule.paid_date = paid_date
    schedule.save(update_fields=["status", "paid_date", "updated_at"])
    return schedule


def scan_and_mark_overdue_schedules(as_of: date | None = None) -> int:
    """
    For pending schedules with due_date before `as_of`, mark overdue and
    recalculate overdue_extra_interest.
    """
    as_of_d = _as_date(as_of)
    qs = PaymentSchedule.objects.filter(
        status=PaymentSchedule.STATUS_PENDING, due_date__lt=as_of_d
    ).select_related("loan")

    updated = 0
    with transaction.atomic():
        for schedule in qs:
            mark_schedule_overdue(schedule, as_of_d)
            updated += 1
    return updated
