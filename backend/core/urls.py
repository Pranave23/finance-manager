from django.urls import path
from .views import LoanCreateView, LoanListView, LoanDeleteView

urlpatterns = [
    path("create/", LoanCreateView.as_view()),
    path("list/", LoanListView.as_view()),
    path("delete/<int:pk>/", LoanDeleteView.as_view()),
]