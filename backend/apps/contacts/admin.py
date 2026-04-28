from django.contrib import admin

from apps.contacts.models import Contact


@admin.register(Contact)
class ContactAdmin(admin.ModelAdmin):
    list_display = ("name", "type", "phone_number", "aadhaar_number", "created_at")
    search_fields = ("name", "phone_number", "aadhaar_number")
