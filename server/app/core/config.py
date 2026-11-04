"""Fail-closed configuration for an explicitly enabled synthetic-data deployment."""
import base64
import json
import os
from dataclasses import dataclass
from enum import Enum
from pathlib import Path

from sqlalchemy.engine import make_url

PRESENTATION_DATABASE_PATH = Path(__file__).resolve().parents[2] / "data" / "presentation.db"


class Role(str, Enum):
    RADIOLOGIST = "Radiologist"
    RESEARCHER = "Researcher"
    COMPLIANCE_OFFICER = "ComplianceOfficer"


@dataclass(frozen=True)
class Settings:
    database_url: str
    encryption_key: bytes
    jwt_secret: str
    jwt_issuer: str
    jwt_audience: str
    users: dict[str, Role]
    dev_cors: bool = False
    presentation_mode: bool = False

    @classmethod
    def from_env(cls) -> "Settings":
        if os.environ.get("LOCAL_NO_PHI_MODE") != "true":
            raise ValueError("Set LOCAL_NO_PHI_MODE=true explicitly; synthetic data only. Not clinically validated.")
        try:
            key = base64.b64decode(os.environ["PHI_ENCRYPTION_KEY"], validate=True)
            secret = os.environ["JWT_SECRET"]
            issuer = os.environ["JWT_ISSUER"].strip()
            audience = os.environ["JWT_AUDIENCE"].strip()
            raw_users = json.loads(os.environ["LOCAL_USERS_JSON"])
        except (KeyError, ValueError) as exc:
            raise ValueError("Missing or invalid explicit security configuration") from exc
        if len(key) != 32 or len(secret.encode()) < 32 or not issuer or not audience:
            raise ValueError("AES key must be 32 bytes; JWT secret >=32 bytes; issuer/audience required")
        if key == secret.encode() or base64.b64encode(key).decode() == secret:
            raise ValueError("Use independent encryption and signing keys")
        if not isinstance(raw_users, dict) or not raw_users:
            raise ValueError("LOCAL_USERS_JSON must be a nonempty subject-to-role object")
        users = {}
        for subject, role in raw_users.items():
            if not isinstance(subject, str) or not subject.strip() or len(subject) > 128:
                raise ValueError("Invalid configured subject")
            users[subject] = Role(role)
        url = os.environ.get("DATABASE_URL", "sqlite:///./data/platform.db")
        if not url.startswith(("sqlite:///", "postgresql+psycopg://")):
            raise ValueError("Only local SQLite or PostgreSQL via psycopg are supported")
        presentation_mode = os.environ.get("PRESENTATION_MODE") == "true"
        if presentation_mode:
            presentation_path = PRESENTATION_DATABASE_PATH.resolve()
            if url.startswith("sqlite:///"):
                database = make_url(url).database
                if database and database.startswith("file:"):
                    raise ValueError("Presentation mode requires a plain SQLite DATABASE_URL for isolation")
                if database and database != ":memory:":
                    workflow_path = Path(database).resolve()
                    if workflow_path == presentation_path or (
                        workflow_path.exists() and presentation_path.exists() and workflow_path.samefile(presentation_path)
                    ):
                        raise ValueError("Presentation database must not reuse the normal DATABASE_URL")
            url = "sqlite:///" + str(presentation_path)
        return cls(url, key, secret, issuer, audience, users,
                   dev_cors=os.environ.get("DEV_CORS") == "true", presentation_mode=presentation_mode)
