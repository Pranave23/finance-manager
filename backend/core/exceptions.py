from rest_framework.views import exception_handler as drf_exception_handler


def _message_for_detail(detail):
    if isinstance(detail, list):
        parts = [_message_for_detail(d) for d in detail]
        return "; ".join(p for p in parts if p) or "Request failed"
    if isinstance(detail, dict):
        return "Request failed"
    return str(detail)


def custom_exception_handler(exc, context):
    response = drf_exception_handler(exc, context)
    if response is None:
        return None

    data = response.data
    message = "Request failed"
    errors = None

    if isinstance(data, dict):
        if "detail" in data:
            message = _message_for_detail(data["detail"])
            rest = {k: v for k, v in data.items() if k != "detail"}
            errors = rest if rest else None
        else:
            message = "Validation failed"
            errors = data
    elif isinstance(data, list):
        message = _message_for_detail(data)
        errors = {"non_field_errors": data}

    response.data = {
        "data": None,
        "message": message,
        "errors": errors,
    }
    return response
