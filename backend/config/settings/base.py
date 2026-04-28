"""Base Django settings shared by all environments."""

from datetime import timedelta
from pathlib import Path
from urllib.parse import urlparse

from decouple import Csv, config

BASE_DIR = Path(__file__).resolve().parent.parent.parent


def _database_from_url(url: str) -> dict:
    parsed = urlparse(url)
    if parsed.scheme == "sqlite":
        # sqlite:///relative.db or sqlite:////absolute/path.db
        raw_path = parsed.path or ""
        if parsed.netloc:
            name = f"{parsed.netloc}{raw_path}" or str(BASE_DIR / "db.sqlite3")
        elif raw_path.startswith("/") and len(raw_path) > 1:
            name = raw_path
        else:
            name = str(BASE_DIR / (raw_path.lstrip("/") or "db.sqlite3"))
        return {"ENGINE": "django.db.backends.sqlite3", "NAME": name}
    path = (parsed.path or "").lstrip("/")
    return {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": path,
        "USER": parsed.username or "",
        "PASSWORD": parsed.password or "",
        "HOST": parsed.hostname or "",
        "PORT": str(parsed.port or 5432),
    }


SECRET_KEY = config("DJANGO_SECRET_KEY", default="django-insecure-dev-only-change-me")

DEBUG = config("DJANGO_DEBUG", default=False, cast=bool)

ALLOWED_HOSTS: list[str] = list(
    config("DJANGO_ALLOWED_HOSTS", default="localhost,127.0.0.1", cast=Csv())
)

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "corsheaders",
    "core",
    "apps.contacts",
    "apps.loans",
    "apps.payments",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

_sqlite_default_path = (BASE_DIR / "db.sqlite3").as_posix()
DATABASES = {
    "default": _database_from_url(
        config("DATABASE_URL", default=f"sqlite:///{_sqlite_default_path}")
    )
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

CORS_ALLOW_CREDENTIALS = True
CORS_ALLOWED_ORIGINS = list(
    config("CORS_ALLOWED_ORIGINS", default="http://localhost:3000", cast=Csv())
)

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "DEFAULT_PAGINATION_CLASS": "core.pagination.StandardResultsSetPagination",
    "PAGE_SIZE": 20,
    "EXCEPTION_HANDLER": "core.exceptions.custom_exception_handler",
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=60),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": False,
}
