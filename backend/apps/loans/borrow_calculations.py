from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from django.db.models import Sum
from apps.loans.models import Borrow, BorrowPayment


def _quantize(value: Decimal) -> Decimal:
    return value.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def compute_fixed_principal_metrics(borrow: Borrow) -> dict:
    """Compute derived fields for the reducing‑balance fixed‑principal model.
    Returns a dictionary suitable for merging into a serializer representation.
    """
    # Aggregate payment components
    aggregates = borrow.payments.aggregate(
        total_paid=Sum('amount_paid'),
        total_interest=Sum('interest_component'),
        total_principal=Sum('principal_component'),
    )
    total_paid = _quantize(aggregates['total_paid'] or Decimal('0'))
    total_interest_paid = _quantize(aggregates['total_interest'] or Decimal('0'))
    total_principal_paid = _quantize(aggregates['total_principal'] or Decimal('0'))

    principal_amount = Decimal(borrow.principal_amount)
    remaining_balance = principal_amount - total_principal_paid
    if remaining_balance < Decimal('0'):
        remaining_balance = Decimal('0')
    remaining_balance = _quantize(remaining_balance)

    # Status determination
    if remaining_balance <= Decimal('0') and total_paid > Decimal('0'):
        status = 'Paid'
    elif total_paid > Decimal('0'):
        status = 'Partial'
    else:
        status = 'Unpaid'

    # Overdue detection
    is_overdue = (
        borrow.due_date is not None
        and borrow.due_date < date.today()
        and status != 'Paid'
    )

    # Current period interest due (simple interest for the period)
    rate_per_period = Decimal(borrow.interest_rate) / Decimal('100') if borrow.interest_rate else Decimal('0')
    current_period_interest_due = _quantize(remaining_balance * rate_per_period)

    # Suggested next payment
    principal_component = borrow.fixed_principal_installment
    if remaining_balance < principal_component:
        principal_component = remaining_balance
    suggested_next_payment = _quantize(principal_component + current_period_interest_due)

    return {
        'total_paid': total_paid,
        'total_interest_paid': total_interest_paid,
        'total_principal_paid': total_principal_paid,
        'remaining_balance': remaining_balance,
        'status': status,
        'is_overdue': is_overdue,
        'current_period_interest_due': current_period_interest_due,
        'suggested_next_payment': suggested_next_payment,
    }
