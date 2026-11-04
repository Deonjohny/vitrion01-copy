import base64
import json

import jwt
import pytest
from cryptography.exceptions import InvalidTag

from app.core.config import Settings
from app.core.crypto import FieldCipher
from conftest import authorization


def test_encryption_nonces_tamper_and_aad():
    cipher = FieldCipher(b"x" * 32)
    first = cipher.encrypt("synthetic-text", "case-one", "reportText")
    second = cipher.encrypt("synthetic-text", "case-one", "reportText")
    assert first != second
    assert len(base64.b64decode(first[3:])) == 12 + len("synthetic-text") + 16
    assert cipher.decrypt(first, "case-one", "reportText") == "synthetic-text"
    with pytest.raises(InvalidTag):
        cipher.decrypt(first, "case-two", "reportText")
    with pytest.raises(InvalidTag):
        cipher.decrypt(first, "case-one", "patientPseudoId")
    payload = bytearray(base64.b64decode(first[3:]))
    payload[-1] ^= 1
    with pytest.raises(InvalidTag):
        cipher.decrypt("v1:" + base64.b64encode(payload).decode(), "case-one", "reportText")
    with pytest.raises(ValueError):
        FieldCipher(b"short")


def test_startup_requires_explicit_mode_and_secrets(monkeypatch):
    monkeypatch.delenv("LOCAL_NO_PHI_MODE", raising=False)
    with pytest.raises(ValueError, match="synthetic data only"):
        Settings.from_env()
    monkeypatch.setenv("LOCAL_NO_PHI_MODE", "true")
    monkeypatch.setenv("PHI_ENCRYPTION_KEY", "")
    monkeypatch.setenv("JWT_SECRET", "")
    monkeypatch.setenv("JWT_ISSUER", "test")
    monkeypatch.setenv("JWT_AUDIENCE", "test")
    monkeypatch.setenv("LOCAL_USERS_JSON", "{}")
    with pytest.raises(ValueError):
        Settings.from_env()
    monkeypatch.setenv("PHI_ENCRYPTION_KEY", base64.b64encode(b"k" * 32).decode())
    monkeypatch.setenv("JWT_SECRET", "s" * 48)
    monkeypatch.setenv("LOCAL_USERS_JSON", json.dumps({"demo": "Administrator"}))
    with pytest.raises(ValueError):
        Settings.from_env()
    monkeypatch.setenv("LOCAL_USERS_JSON", json.dumps({"demo": "Radiologist"}))
    assert Settings.from_env().users["demo"].value == "Radiologist"


def test_authentication_and_server_authoritative_roles(local_service, synthetic_case):
    client, _, config = local_service
    assert client.get("/api/health").json()["clinicallyValidated"] is False
    assert client.get("/api/cases").status_code == 401
    for overrides in ({"exp": 1}, {"aud": "wrong"}, {"iss": "wrong"}, {"sub": "not-registered"}, {"nbf": 9999999999}, {"exp": 9999999999}):
        assert client.get("/api/cases", headers=authorization(config, **overrides)).status_code == 401
    wrong_key = jwt.encode({"sub": "rad-one"}, "wrong" * 10, algorithm="HS256")
    assert client.get("/api/cases", headers={"Authorization": "Bearer " + wrong_key}).status_code == 401
    none_token = jwt.encode({"sub": "rad-one"}, key="", algorithm="none")
    assert client.get("/api/cases", headers={"Authorization": "Bearer " + none_token}).status_code == 401
    researcher = authorization(config, "research", role="Radiologist")
    assert client.post("/api/cases", headers=researcher, json=synthetic_case).status_code == 403
    assert client.get("/api/cases", headers=authorization(config, "compliance")).status_code == 403
    body = {**synthetic_case, "role": "Radiologist"}
    assert client.post("/api/cases", headers=authorization(config), json=body).status_code == 422
    assert client.get("/api/audit/verify", headers=authorization(config)).status_code == 403
    assert client.get("/api/audit/events").status_code == 401
    assert client.get("/api/session").status_code == 401
    for subject, role in (("rad-one", "Radiologist"), ("research", "Researcher"), ("compliance", "ComplianceOfficer")):
        session = client.get("/api/session", headers=authorization(config, subject))
        assert session.status_code == 200
        assert session.json() == {"subject": subject, "role": role}
        assert session.headers["cache-control"] == "no-store"
