"""Offline local key generation/token issuance. Never expose this as an HTTP endpoint."""
import argparse
import base64
import json
import secrets
from datetime import datetime, timedelta, timezone

import jwt

from app.core.config import Settings


def main():
    parser = argparse.ArgumentParser(description="Local synthetic-data operator utility")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("keys", help="Print independent keys; keep output private and do not commit it")
    token = commands.add_parser("token", help="Mint a <=60-minute token for a configured subject")
    token.add_argument("--subject", required=True)
    token.add_argument("--minutes", type=int, default=15, choices=range(1, 61))
    args = parser.parse_args()
    if args.command == "keys":
        print(json.dumps({"PHI_ENCRYPTION_KEY": base64.b64encode(secrets.token_bytes(32)).decode(), "JWT_SECRET": secrets.token_urlsafe(48)}))
        return
    config = Settings.from_env()
    if args.subject not in config.users:
        parser.error("Subject must be explicitly registered in LOCAL_USERS_JSON")
    now = datetime.now(timezone.utc)
    claims = {"sub": args.subject, "iat": now, "nbf": now, "exp": now + timedelta(minutes=args.minutes), "iss": config.jwt_issuer, "aud": config.jwt_audience}
    print(jwt.encode(claims, config.jwt_secret, algorithm="HS256"))


if __name__ == "__main__":
    main()
