"""Lend interest, repayment schedule, LTV & collateral coverage calculations."""
from datetime import date
from decimal import Decimal
import math

from apps.loans.borrow_calculations import (
    CENT,
    PERIOD_DAYS,
    ZERO,
    add_schedule_periods,
    q,
)
from apps.loans.models import Lend


def _periods_between(lend: Lend, start: date, end: date) -> Decimal:
    days = max((end - start).days, 0)
    return Decimal(days) / PERIOD_DAYS.get(lend.rate_period, PERIOD_DAYS[Lend.PERIOD_MONTHLY])


def lend_interest_until(lend: Lend, end: date) -> Decimal:
    principal = Decimal(lend.principal_amount)
    if lend.interest_type == Lend.INTEREST_MANUAL:
        manual_amt = Decimal(lend.manual_interest_amount or ZERO)
        if manual_amt <= 0:
            return ZERO
        if lend.rate_period == Lend.PERIOD_OVERALL or not lend.rate_period:
            return q(manual_amt)
        t = _periods_between(lend, lend.lent_date, end)
        return q(manual_amt * t)

    rate = Decimal(lend.interest_rate or ZERO) / Decimal("100")
    if rate <= 0:
        return ZERO
    t = _periods_between(lend, lend.lent_date, end)

    if lend.interest_type == Lend.INTEREST_COMPOUND:
        growth = Decimal(str((1 + float(rate)) ** float(t)))
        return q(principal * (growth - 1))
    return q(principal * rate * t)


def _settled_date(lend: Lend, payments) -> date | None:
    paid = ZERO
    principal = Decimal(lend.principal_amount)
    for p in sorted(payments, key=lambda x: (x.payment_date, x.created_at)):
        paid += Decimal(p.amount_paid)
        if paid >= principal + lend_interest_until(lend, p.payment_date):
            return p.payment_date
    return None


def _schedule_period_interest(lend: Lend, sched: str) -> Decimal:
    principal = Decimal(lend.principal_amount)
    sched_days = PERIOD_DAYS.get(sched, PERIOD_DAYS[Lend.PERIOD_MONTHLY])
    rate_days = PERIOD_DAYS.get(lend.rate_period, PERIOD_DAYS[Lend.PERIOD_MONTHLY])
    ratio = sched_days / rate_days

    if lend.interest_type == Lend.INTEREST_MANUAL:
        if lend.rate_period == Lend.PERIOD_OVERALL:
            return ZERO
        return q(Decimal(lend.manual_interest_amount or ZERO) * ratio)

    rate = Decimal(lend.interest_rate or ZERO) / Decimal("100")
    if rate <= 0:
        return ZERO
    if lend.interest_type == Lend.INTEREST_COMPOUND:
        growth = Decimal(str((1 + float(rate)) ** float(ratio)))
        return q(principal * (growth - 1))
    return q(principal * rate * ratio)


def compute_lend_metrics(lend: Lend, today: date | None = None) -> dict:
    today = today or date.today()
    principal = q(lend.principal_amount)
    payments = list(lend.payments.all())
    total_paid = q(sum((Decimal(p.amount_paid) for p in payments), ZERO))

    # --- Estimate: everything collected on the due date, nothing late ---
    tenure_periods = None
    estimated_interest = None
    estimated_total = None
    if lend.due_date:
        if lend.interest_type == Lend.INTEREST_MANUAL and lend.rate_period == Lend.PERIOD_OVERALL:
            tenure_periods = None
        else:
            tenure_periods = _periods_between(lend, lend.lent_date, lend.due_date)
        estimated_interest = lend_interest_until(lend, lend.due_date)
        estimated_total = q(principal + estimated_interest)
    elif lend.interest_type == Lend.INTEREST_MANUAL and lend.rate_period == Lend.PERIOD_OVERALL:
        estimated_interest = q(lend.manual_interest_amount or ZERO)
        estimated_total = q(principal + estimated_interest)

    # --- Actuals to date ---
    settled_on = _settled_date(lend, payments)
    accrual_end = settled_on or today
    accrued_interest = lend_interest_until(lend, accrual_end)
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

    is_overdue = bool(lend.due_date and today > lend.due_date and status != "Paid")
    days_overdue = (today - lend.due_date).days if is_overdue else 0

    if lend.interest_type == Lend.INTEREST_MANUAL:
        interest_per_period = (
            None
            if lend.rate_period == Lend.PERIOD_OVERALL
            else q(lend.manual_interest_amount or ZERO)
        )
    else:
        rate = Decimal(lend.interest_rate or ZERO) / Decimal("100")
        interest_per_period = q(principal * rate)

    # --- Promised next collection & early/late schedule tracking ---
    sched = lend.repayment_schedule_type or Lend.SCHEDULE_MONTHLY
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
        if sched == Lend.SCHEDULE_ONE_TIME:
            total_scheduled_installments = 1 if lend.due_date else None
            next_payment_date = lend.due_date
            base_target = estimated_total if estimated_total is not None else total_payable_to_date
            next_payment_amount = q(max(base_target - total_paid, remaining_balance))
        else:
            sched_days = PERIOD_DAYS.get(sched, PERIOD_DAYS[Lend.PERIOD_MONTHLY])
            if lend.due_date:
                total_days = max((lend.due_date - lend.lent_date).days, 1)
                n_total = max(1, math.ceil(float(Decimal(total_days) / sched_days) - 1e-9))
                total_scheduled_installments = n_total
                target_total = estimated_total if estimated_total is not None else total_payable_to_date
                regular_installment = q(target_total / Decimal(n_total))

                if regular_installment > 0:
                    installments_completed = min(int(total_paid // regular_installment), n_total - 1)
                next_k = installments_completed + 1
                cand_date = add_schedule_periods(lend.lent_date, sched, next_k)
                if cand_date > lend.due_date:
                    cand_date = lend.due_date
                next_payment_date = cand_date

                cumulative_target = min(regular_installment * Decimal(next_k), target_total)
                needed_for_milestone = q(max(cumulative_target - total_paid, ZERO))
                remaining_if_on_time = q(max(target_total - total_paid, ZERO))
                next_payment_amount = min(
                    needed_for_milestone if needed_for_milestone > 0 else regular_installment,
                    remaining_if_on_time,
                )
            else:
                per_sched_int = _schedule_period_interest(lend, sched)
                regular_installment = per_sched_int if per_sched_int > 0 else q(principal * Decimal("0.10"))
                installments_completed = len(payments)
                next_k = installments_completed + 1
                next_payment_date = add_schedule_periods(lend.lent_date, sched, next_k)
                next_payment_amount = min(
                    regular_installment if regular_installment > 0 else remaining_balance,
                    remaining_balance,
                )

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
                prev_due = add_schedule_periods(lend.lent_date, sched, installments_completed)
                if today <= prev_due:
                    schedule_status = "early"

        if lend.due_date and estimated_total is not None:
            if today > lend.due_date:
                projected_final_total = total_payable_to_date
                late_extra_interest = q(max(total_payable_to_date - estimated_total, ZERO))
            else:
                early_savings = q(max(estimated_total - total_payable_to_date, ZERO))
                projected_final_total = estimated_total
    else:
        if lend.due_date and estimated_total is not None:
            if total_payable_to_date < estimated_total:
                early_savings = q(estimated_total - total_payable_to_date)
                schedule_status = "settled_early"
            elif total_payable_to_date > estimated_total:
                late_extra_interest = q(total_payable_to_date - estimated_total)
                schedule_status = "settled_late"
            projected_final_total = total_payable_to_date

    # --- Standard Finance Metrics: LTV, Collateral Coverage & Checklist ---
    collateral_val = q(lend.collateral_estimated_value or ZERO)
    is_secured = lend.collateral_type != Lend.COLLATERAL_NONE and collateral_val > 0
    ltv_percent = None
    collateral_coverage_ratio = None
    risk_grade = "Unsecured"

    if is_secured:
        ltv_percent = q((principal / collateral_val) * Decimal("100"))
        if remaining_balance > 0:
            collateral_coverage_ratio = q(collateral_val / remaining_balance)
        else:
            collateral_coverage_ratio = q(collateral_val / principal)

        if ltv_percent <= Decimal("60"):
            risk_grade = "Safe (Low LTV)"
        elif ltv_percent <= Decimal("80"):
            risk_grade = "Moderate LTV"
        elif ltv_percent <= Decimal("100"):
            risk_grade = "High LTV (Tight Margin)"
        else:
            risk_grade = "Under-collateralized (LTV > 100%)"

    # Checklist completion progress (pre-disbursement / active items)
    has_collateral = lend.collateral_type != Lend.COLLATERAL_NONE
    active_checks = [
        bool(lend.chk_aadhar_verified),
        bool(lend.chk_mobile_verified),
        bool(lend.chk_agreement_signed),
        bool(lend.chk_security_cheque),
    ]
    if has_collateral:
        active_checks.extend([
            bool(lend.chk_collateral_inspected),
            bool(lend.chk_collateral_possessed),
        ])
    checklist_completed = sum(1 for c in active_checks if c)
    checklist_total = len(active_checks)

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
        "is_secured": is_secured,
        "ltv_percent": ltv_percent,
        "collateral_coverage_ratio": collateral_coverage_ratio,
        "risk_grade": risk_grade,
        "checklist_completed": checklist_completed,
        "checklist_total": checklist_total,
    }
