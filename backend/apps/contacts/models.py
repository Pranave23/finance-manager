from django.db import models

from core.models import BaseModel


class Contact(BaseModel):
    TYPE_BORROWER = "borrower"
    TYPE_LENDER = "lender"
    TYPE_CHOICES = [
        (TYPE_BORROWER, "Borrower"),
        (TYPE_LENDER, "Lender"),
    ]

    name = models.CharField(max_length=255)
    phone_number = models.CharField(max_length=32)
    aadhaar_number = models.CharField(max_length=32, unique=True)
    type = models.CharField(max_length=16, choices=TYPE_CHOICES)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name
