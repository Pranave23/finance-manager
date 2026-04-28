from django.urls import path
from rest_framework.routers import DefaultRouter

from apps.contacts.views import ContactViewSet
from apps.loans.views import LoanViewSet
from apps.payments.views import (
    PaymentViewSet,
    ScheduleCheckOverdueView,
    ScheduleMarkOverdueView,
    ScheduleMarkPaidView,
)
from core.jwt_views import (
    EnvelopeTokenObtainPairView,
    EnvelopeTokenRefreshView,
    RegisterUserView,
)

router = DefaultRouter()
router.register(r"contacts", ContactViewSet, basename="contact")
router.register(r"loans", LoanViewSet, basename="loan")
router.register(r"payments", PaymentViewSet, basename="payment")

urlpatterns = [
    path("auth/register/", RegisterUserView.as_view(), name="auth_register"),
    path(
        "auth/token/",
        EnvelopeTokenObtainPairView.as_view(),
        name="token_obtain_pair",
    ),
    path(
        "auth/token/refresh/",
        EnvelopeTokenRefreshView.as_view(),
        name="token_refresh",
    ),
    path(
        "schedule/check-overdue/",
        ScheduleCheckOverdueView.as_view(),
        name="schedule-check-overdue",
    ),
    path(
        "schedule/<uuid:pk>/mark-paid/",
        ScheduleMarkPaidView.as_view(),
        name="schedule-mark-paid",
    ),
    path(
        "schedule/<uuid:pk>/mark-overdue/",
        ScheduleMarkOverdueView.as_view(),
        name="schedule-mark-overdue",
    ),
] + router.urls
