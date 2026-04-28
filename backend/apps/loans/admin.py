from django.contrib import admin

from apps.loans.models import Loan


@admin.register(Loan)
class LoanAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "contact",
        "direction",
        "principal_amount",
        "interest_rate",
        "interest_period",
        "status",
        "start_date",
    )
    list_filter = ("direction", "status", "interest_period")
    search_fields = ("contact__name", "notes")
    autocomplete_fields = ("contact",)
