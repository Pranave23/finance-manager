class EnvelopeMixin:
    """Wrap successful JSON responses in { data, message, errors }."""

    envelope_message = "Success"

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        if response.status_code == 204:
            return response
        if not (200 <= response.status_code < 300):
            return response
        if isinstance(response.data, dict) and {"data", "message", "errors"} <= set(
            response.data.keys()
        ):
            return response
        response.data = {
            "data": response.data,
            "message": getattr(self, "envelope_message", "Success"),
            "errors": None,
        }
        return response
