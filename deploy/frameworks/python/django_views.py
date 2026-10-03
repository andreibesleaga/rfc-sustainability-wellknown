"""Django: add to urls.py  path(".well-known/sustainability-data", declaration)  (no trailing slash)."""
from django.http import HttpResponse, JsonResponse
from django.views.decorators.http import require_http_methods

from declaration import BODY, HEADERS, fresh


@require_http_methods(["GET", "HEAD"])  # other methods get Django's 405 with Allow
def declaration(request):
    if fresh(request.headers.get("If-None-Match")):
        response = HttpResponse(b"", status=304)
    elif request.method == "HEAD":
        # Django does not strip a body for HEAD, so send none and state GET's length (RFC 9110 §8.6).
        response = HttpResponse(b"", status=200)
        response["Content-Length"] = str(len(BODY))
    else:
        response = HttpResponse(BODY, status=200)
    for name, value in HEADERS.items():
        response[name] = value
    return response
