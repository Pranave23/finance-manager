from rest_framework import viewsets

from apps.contacts.models import Contact
from apps.contacts.serializers import ContactDetailSerializer, ContactSerializer
from core.mixins import EnvelopeMixin


class ContactViewSet(EnvelopeMixin, viewsets.ModelViewSet):
    queryset = Contact.objects.all()
    envelope_message = "OK"

    def get_serializer_class(self):
        if self.action == "retrieve":
            return ContactDetailSerializer
        return ContactSerializer
