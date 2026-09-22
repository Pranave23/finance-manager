from django.contrib.auth import authenticate, get_user_model
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView


class EnvelopeTokenObtainPairView(TokenObtainPairView):
    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        if response.status_code == status.HTTP_200_OK:
            return Response(
                {
                    "data": response.data,
                    "message": "Tokens issued successfully",
                    "errors": None,
                },
                status=response.status_code,
            )
        return Response(
            {
                "data": None,
                "message": "Could not validate credentials",
                "errors": response.data,
            },
            status=response.status_code,
        )


class EnvelopeTokenRefreshView(TokenRefreshView):
    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        if response.status_code == status.HTTP_200_OK:
            return Response(
                {
                    "data": response.data,
                    "message": "Token refreshed successfully",
                    "errors": None,
                },
                status=response.status_code,
            )
        return Response(
            {
                "data": None,
                "message": "Could not refresh token",
                "errors": response.data,
            },
            status=response.status_code,
        )


class MobileRegisterView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        mobile_number = request.data.get("mobile_number", "").strip()
        password = request.data.get("password", "")

        if not mobile_number or not password:
            return Response(
                {
                    "data": None,
                    "message": "Mobile number and password are required.",
                    "errors": {
                        "detail": "Mobile number and password are required."
                    },
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if len(mobile_number) < 7:
            return Response(
                {
                    "data": None,
                    "message": "Please enter a valid mobile number.",
                    "errors": {"mobile_number": ["Enter a valid mobile number."]},
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        user_model = get_user_model()
        if user_model.objects.filter(username=mobile_number).exists():
            return Response(
                {
                    "data": None,
                    "message": "User with this mobile number already exists.",
                    "errors": {"mobile_number": ["Mobile number already registered."]},
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = user_model.objects.create_user(
            username=mobile_number,
            password=password,
        )

        refresh = RefreshToken.for_user(user)

        return Response(
            {
                "data": {
                    "user": {"id": str(user.pk), "mobile_number": user.username},
                    "access": str(refresh.access_token),
                    "refresh": str(refresh),
                },
                "message": "User registered and logged in successfully.",
                "errors": None,
            },
            status=status.HTTP_201_CREATED,
        )


class MobileLoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        mobile_number = request.data.get("mobile_number", "").strip()
        password = request.data.get("password", "")

        if not mobile_number or not password:
            return Response(
                {
                    "data": None,
                    "message": "Mobile number and password are required.",
                    "errors": {
                        "detail": "Mobile number and password are required."
                    },
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = authenticate(username=mobile_number, password=password)
        if not user:
            return Response(
                {
                    "data": None,
                    "message": "Invalid mobile number or password.",
                    "errors": {"password": ["Invalid credentials."]},
                },
                status=status.HTTP_401_UNAUTHORIZED,
            )

        refresh = RefreshToken.for_user(user)

        return Response(
            {
                "data": {
                    "user": {"id": str(user.pk), "mobile_number": user.username},
                    "access": str(refresh.access_token),
                    "refresh": str(refresh),
                },
                "message": "Login successful.",
                "errors": None,
            },
            status=status.HTTP_200_OK,
        )
