from django.contrib import admin

from apps.payments.models import Payment, PaymentSchedule


class PaymentInline(admin.TabularInline):
    model = Payment
    extra = 0


@admin.register(PaymentSchedule)
class PaymentScheduleAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "loan",
        "due_date",
        "amount_due",
        "principal_due",
        "status",
        "paid_date",
        "overdue_extra_interest",
    )
    list_filter = ("status",)
    autocomplete_fields = ("loan",)
    search_fields = ("id", "loan__id")
    inlines = (PaymentInline,)


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ("id", "loan", "schedule", "amount_paid", "paid_on")
    autocomplete_fields = ("loan", "schedule")
    search_fields = ("id", "loan__id", "schedule__id")
    
