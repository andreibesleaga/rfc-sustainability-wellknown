"""Flask: one route. Run: PORT=3000 python3 flask_app.py"""
import os
from flask import Flask, Response, request
from declaration import BODY, HEADERS, PATH, fresh

app = Flask(__name__)

@app.route(PATH, methods=["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH"])
def declaration():
    if request.method not in ("GET", "HEAD"):
        return Response('{"error":"method not allowed"}', status=405,
                        headers={"Allow": "GET, HEAD", "Content-Type": "application/json", "X-Content-Type-Options": "nosniff"})
    if fresh(request.headers.get("If-None-Match")):
        return Response(b"", status=304, headers=HEADERS)
    return Response(BODY, status=200, headers=HEADERS)  # Werkzeug drops the body for HEAD and keeps Content-Length

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "3000")))
