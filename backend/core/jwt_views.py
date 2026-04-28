from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
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


class RegisterSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(write_only=True)

    def validate_username(self, value):
        user_model = get_user_model()
        if user_model.objects.filter(username=value).exists():
            raise serializers.ValidationError("Username is already taken.")
        return value

    def validate_password(self, value):
        validate_password(value)
        return value


class RegisterUserView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, *args, **kwargs):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user_model = get_user_model()
        user = user_model.objects.create_user(
            username=serializer.validated_data["username"],
            password=serializer.validated_data["password"],
        )
        return Response(
            {
                "data": {"id": str(user.pk), "username": user.username},
                "message": "User created successfully",
                "errors": None,
            },
            status=status.HTTP_201_CREATED,
        )
