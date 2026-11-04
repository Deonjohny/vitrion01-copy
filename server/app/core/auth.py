import re
from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import Role

bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class Principal:
    subject: str
    role: Role
    is_presentation: bool = False


def _local_presentation_request(request: Request) -> bool:
    if request.client is None or request.client.host not in {"127.0.0.1", "::1"}:
        return False
    hosts = request.headers.getlist("host")
    if len(hosts) != 1:
        return False
    host = re.fullmatch(r"(?:127\.0\.0\.1|localhost|\[::1\])(?::([0-9]{1,5}))?", hosts[0], re.IGNORECASE)
    if host is None or (host.group(1) is not None and not 1 <= int(host.group(1)) <= 65535):
        return False
    origins = request.headers.getlist("origin")
    if origins and (len(origins) != 1 or origins[0] not in {"http://127.0.0.1:3001", "http://localhost:3001"}):
        return False
    sites = request.headers.getlist("sec-fetch-site")
    return not sites or (len(sites) == 1 and sites[0] in {"same-origin", "same-site", "none"})


def authenticate(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(bearer)) -> Principal:
    config = request.app.state.settings
    # HTTPBearer also returns None for malformed/non-bearer headers; never downgrade those to a demo session.
    if credentials is None and config.presentation_mode and "authorization" not in request.headers:
        if not _local_presentation_request(request):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Presentation access requires a trusted loopback request")
        return Principal("local-presentation", Role.RADIOLOGIST, is_presentation=True)
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Bearer token required", headers={"WWW-Authenticate": "Bearer"})
    try:
        claims = jwt.decode(credentials.credentials, config.jwt_secret, algorithms=["HS256"], issuer=config.jwt_issuer, audience=config.jwt_audience, options={"require": ["exp", "iat", "nbf", "iss", "aud", "sub"]}, leeway=0)
        subject = claims["sub"]
        if not isinstance(subject, str) or subject not in config.users:
            raise ValueError("Unregistered subject")
        if claims["exp"] - claims["iat"] > 3600:
            raise ValueError("Token lifetime too long")
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token", headers={"WWW-Authenticate": "Bearer"}) from None
    return Principal(subject, config.users[subject])


def require_roles(*roles: Role):
    def authorized(principal: Principal = Depends(authenticate)) -> Principal:
        if principal.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Role not permitted")
        return principal
    return authorized
