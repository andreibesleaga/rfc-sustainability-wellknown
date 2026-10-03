"""FastAPI: one route. Run: PORT=3000 uvicorn fastapi_app:app --port $PORT"""
from fastapi import FastAPI, Request, Response
from declaration import BODY, HEADERS, PATH, fresh

app = FastAPI()

@app.api_route(PATH, methods=["GET", "HEAD"])
async def declaration(request: Request):
    if fresh(request.headers.get("if-none-match")):
        return Response(content=b"", status_code=304, headers=HEADERS)
    return Response(content=BODY, status_code=200, headers=HEADERS)  # uvicorn drops the body for HEAD and keeps content-length

@app.api_route(PATH, methods=["POST", "PUT", "DELETE", "PATCH"])
async def not_allowed():
    return Response(content='{"error":"method not allowed"}', status_code=405,
                    headers={"Allow": "GET, HEAD", "Content-Type": "application/json", "X-Content-Type-Options": "nosniff"})
