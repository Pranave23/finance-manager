# Generated manually for Borrow module

import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("loans", "0002_borrowlend"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="Lender",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("name", models.CharField(max_length=255)),
                ("phone", models.CharField(max_length=32)),
                ("email", models.EmailField(blank=True, default="", max_length=254)),
                ("notes", models.TextField(blank=True, default="")),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="lenders",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["name", "-created_at"],
            },
        ),
        migrations.CreateModel(
            name="Borrow",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("principal_amount", models.DecimalField(decimal_places=2, max_digits=14)),
                ("currency", models.CharField(default="INR", max_length=8)),
                ("borrowed_date", models.DateField()),
                ("due_date", models.DateField(blank=True, null=True)),
                (
                    "interest_type",
                    models.CharField(
                        choices=[
                            ("Simple", "Simple"),
                            ("Compound", "Compound"),
                            ("Manual", "Manual"),
                            ("None", "None"),
                        ],
                        default="None",
                        max_length=16,
                    ),
                ),
                (
                    "interest_rate",
                    models.DecimalField(
                        blank=True, decimal_places=4, max_digits=7, null=True
                    ),
                ),
                (
                    "rate_period",
                    models.CharField(
                        choices=[
                            ("daily", "Daily"),
                            ("weekly", "Weekly"),
                            ("monthly", "Monthly"),
                            ("yearly", "Yearly"),
                        ],
                        default="monthly",
                        max_length=16,
                    ),
                ),
                (
                    "compounding_frequency",
                    models.CharField(
                        blank=True,
                        choices=[
                            ("daily", "Daily"),
                            ("weekly", "Weekly"),
                            ("monthly", "Monthly"),
                            ("yearly", "Yearly"),
                        ],
                        default="",
                        max_length=16,
                    ),
                ),
                (
                    "manual_interest_amount",
                    models.DecimalField(
                        blank=True, decimal_places=2, max_digits=14, null=True
                    ),
                ),
                (
                    "repayment_schedule_type",
                    models.CharField(
                        choices=[
                            ("one_time", "One time"),
                            ("monthly", "Monthly"),
                            ("weekly", "Weekly"),
                            ("daily", "Daily"),
                        ],
                        default="one_time",
                        max_length=16,
                    ),
                ),
                ("notes", models.TextField(blank=True, default="")),
                (
                    "lender",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="borrows",
                        to="loans.lender",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="borrows",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["-borrowed_date", "-created_at"],
            },
        ),
        migrations.CreateModel(
            name="BorrowPayment",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("amount_paid", models.DecimalField(decimal_places=2, max_digits=14)),
                ("payment_date", models.DateField()),
                ("notes", models.TextField(blank=True, default="")),
                (
                    "borrow",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="payments",
                        to="loans.borrow",
                    ),
                ),
            ],
            options={
                "ordering": ["-payment_date", "-created_at"],
            },
        ),
    ]
