from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path


def root_view(request):
    return JsonResponse(
        {
            "status": "online",
            "message": "Finance Manager Backend API is active.",
            "api_endpoints": "http://127.0.0.1:8000/api/v1/",
            "frontend_app": "http://localhost:3000/",
        }
    )


urlpatterns = [
    path("", root_view, name="root_index"),
    path("admin/", admin.site.urls),
    path("api/v1/", include("config.api_v1_urls")),
]
