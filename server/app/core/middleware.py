import json


class LocalSafetyMiddleware:
    def __init__(self, app, max_body_bytes=1048576):
        self.app = app
        self.max_body_bytes = max_body_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        chunks, size = [], 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            size += len(chunk)
            budget = 12 * 1024 * 1024 if scope.get("path") in ("/api/mri/report", "/api/radiology/infer", "/api/radiology/experimental", "/api/radiology/prepared") else self.max_body_bytes
            if size > budget:
                body = json.dumps({"detail": "Request exceeds bounded body budget"}).encode()
                await send({"type": "http.response.start", "status": 413, "headers": [(b"content-type", b"application/json"), (b"cache-control", b"no-store")]})
                await send({"type": "http.response.body", "body": body})
                return
            chunks.append(chunk)
            if not message.get("more_body", False):
                break
        delivered = False

        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": b"".join(chunks), "more_body": False}
            return await receive()

        async def safe_send(message):
            if message["type"] == "http.response.start":
                message["headers"] = list(message.get("headers", [])) + [(b"cache-control", b"no-store"), (b"x-content-type-options", b"nosniff"), (b"x-clinical-validation", b"none-synthetic-data-only")]
            await send(message)

        await self.app(scope, replay, safe_send)
