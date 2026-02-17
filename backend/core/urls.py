from django.urls import path
from .views import LoanCreateView, LoanListView

urlpatterns = [
    path('create/', LoanCreateView.as_view()),
    path('list/', LoanListView.as_view()),
]