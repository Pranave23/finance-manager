from decimal import Decimal

from rest_framework import status
from rest_framework.response import Response
from rest_framework.serializers import ModelSerializer
from rest_framework.views import APIView

from .models import Loan

class LoanSerializer(ModelSerializer):
    class Meta:
        model = Loan
        fields = "__all__"
        read_only_fields = ("total_amount", "created_at")


def calculate_total(amount: Decimal, rate: Decimal) -> Decimal:
    return amount + (amount * rate / 100)


class LoanCreateView(APIView):
    def post(self, request):
        serializer = LoanSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        amount = serializer.validated_data["amount"]
        rate = serializer.validated_data["interest_rate"]
        total = calculate_total(amount, rate)

        loan = Loan.objects.create(
            name=serializer.validated_data["name"],
            amount=amount,
            interest_rate=rate,
            total_amount=total,
            loan_type=serializer.validated_data["loan_type"],
            interest_period=serializer.validated_data.get("interest_period", Loan.YEARLY),
        )
        return Response(LoanSerializer(loan).data, status=status.HTTP_201_CREATED)


class LoanListView(APIView):
    def get(self, request):
        loans = Loan.objects.all()
        serializer = LoanSerializer(loans, many=True)
        return Response(serializer.data)


class LoanDeleteView(APIView):
    def delete(self, request, pk):
        try:
            loan = Loan.objects.get(pk=pk)
        except Loan.DoesNotExist:
            return Response(
                {"detail": "Loan not found."}, status=status.HTTP_404_NOT_FOUND
            )

        loan.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
