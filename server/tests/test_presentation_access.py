import base64
import hashlib
import io
import json
import shutil
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfWriter

from app.core import config as config_module
from app.core.config import Settings
from app.main import create_app
from app.schemas import SessionDTO
from app.services import report_extraction
from conftest import authorization
from scripts import run_local


@pytest.fixture
def configured_environment(monkeypatch):
    directory = Path(__file__).parent / "_runtime" / ("presentation-" + str(uuid4()))
    directory.mkdir(parents=True)
    settings = {
        "LOCAL_NO_PHI_MODE": "true",
        "PHI_ENCRYPTION_KEY": base64.b64encode(b"e" * 32).decode(),
        "JWT_SECRET": "test-signing-only-" + "s" * 48,
        "JWT_ISSUER": "test-local",
        "JWT_AUDIENCE": "synthetic-client",
        "LOCAL_USERS_JSON": json.dumps({"rad-one": "Radiologist", "rad-two": "Radiologist", "research": "Researcher"}),
        "DATABASE_URL": "sqlite:///" + str(directory / "normal.db"),
        "DEV_CORS": "false",
        "LOCAL_MODELS_ENABLED": "false",
    }
    for name, value in settings.items():
        monkeypatch.setenv(name, value)
    monkeypatch.delenv("PRESENTATION_MODE", raising=False)
    monkeypatch.setattr(config_module, "PRESENTATION_DATABASE_PATH", directory / "presentation.db")
    try:
        yield directory
    finally:
        shutil.rmtree(directory)
        if directory.parent.exists() and not any(directory.parent.iterdir()):
            directory.parent.rmdir()


@pytest.fixture
def presentation_settings(configured_environment, monkeypatch):
    monkeypatch.setenv("PRESENTATION_MODE", "true")
    return Settings.from_env()


def local_client(config, client=("127.0.0.1", 50000)):
    return TestClient(create_app(config), base_url="http://127.0.0.1:8001", client=client)


def test_reserved_database_path_is_absolute():
    expected = Path(config_module.__file__).resolve().parents[2] / "data" / "presentation.db"
    assert config_module.PRESENTATION_DATABASE_PATH == expected
    assert expected.is_absolute()


@pytest.mark.parametrize("value", [None, "false", "TRUE", "1", ""])
def test_presentation_requires_exact_explicit_opt_in(configured_environment, monkeypatch, value):
    if value is not None:
        monkeypatch.setenv("PRESENTATION_MODE", value)
    config = Settings.from_env()
    assert config.presentation_mode is False
    assert config.database_url == "sqlite:///" + str(configured_environment / "normal.db")


@pytest.mark.parametrize("value", [None, "false", ""])
def test_presentation_still_requires_no_phi_acknowledgement(configured_environment, monkeypatch, value):
    monkeypatch.setenv("PRESENTATION_MODE", "true")
    if value is None:
        monkeypatch.delenv("LOCAL_NO_PHI_MODE")
    else:
        monkeypatch.setenv("LOCAL_NO_PHI_MODE", value)
    with pytest.raises(ValueError, match="synthetic data only"):
        Settings.from_env()


@pytest.mark.parametrize("name", ["PHI_ENCRYPTION_KEY", "JWT_SECRET", "JWT_ISSUER", "JWT_AUDIENCE", "LOCAL_USERS_JSON"])
def test_presentation_retains_explicit_security_configuration(configured_environment, monkeypatch, name):
    monkeypatch.setenv("PRESENTATION_MODE", "true")
    monkeypatch.delenv(name)
    with pytest.raises(ValueError, match="security configuration"):
        Settings.from_env()


def test_database_selection_does_not_follow_working_directory(configured_environment, monkeypatch):
    monkeypatch.setenv("PRESENTATION_MODE", "true")
    elsewhere = configured_environment / "elsewhere"
    elsewhere.mkdir()
    with monkeypatch.context() as context:
        context.chdir(elsewhere)
        config = Settings.from_env()
    assert config.presentation_mode is True
    assert config.database_url == "sqlite:///" + str(configured_environment / "presentation.db")


@pytest.mark.parametrize("relative", [False, True])
def test_reusing_normal_database_is_rejected(configured_environment, monkeypatch, relative):
    monkeypatch.setenv("PRESENTATION_MODE", "true")
    with monkeypatch.context() as context:
        context.chdir(configured_environment)
        path = ".\\presentation.db" if relative else str(configured_environment / "presentation.db")
        context.setenv("DATABASE_URL", "sqlite:///" + path)
        with pytest.raises(ValueError, match="must not reuse"):
            Settings.from_env()


def test_sqlite_uri_database_alias_is_rejected(configured_environment, monkeypatch):
    monkeypatch.setenv("PRESENTATION_MODE", "true")
    monkeypatch.setenv("DATABASE_URL", "sqlite:///file:presentation.db?uri=true")
    with pytest.raises(ValueError, match="plain SQLite DATABASE_URL"):
        Settings.from_env()


def test_hardlinked_normal_database_is_rejected(configured_environment, monkeypatch):
    normal = configured_environment / "normal.db"
    normal.write_bytes(b"synthetic database placeholder")
    (configured_environment / "presentation.db").hardlink_to(normal)
    monkeypatch.setenv("PRESENTATION_MODE", "true")
    with pytest.raises(ValueError, match="must not reuse"):
        Settings.from_env()


def test_launcher_accepts_presentation_flag_and_preserves_environment(configured_environment, monkeypatch):
    path = configured_environment / "launcher.env"
    path.write_text("PRESENTATION_MODE=true\n", encoding="utf-8")
    run_local.load_local_env(path)
    assert Settings.from_env().presentation_mode is True
    monkeypatch.setenv("PRESENTATION_MODE", "false")
    run_local.load_local_env(path)
    assert Settings.from_env().presentation_mode is False


def test_normal_mode_requires_jwt_even_on_loopback(configured_environment):
    config = Settings.from_env()
    with local_client(config) as client:
        for endpoint in ("/api/session", "/api/cases"):
            response = client.get(endpoint)
            assert response.status_code == 401
            assert response.headers["www-authenticate"] == "Bearer"
        session = client.get("/api/session", headers=authorization(config))
        assert session.status_code == 200
        assert session.json() == {"subject": "rad-one", "role": "Radiologist"}
        assert SessionDTO.model_validate(session.json()).presentationMode is False


@pytest.mark.parametrize("peer,host,origin", [
    ("127.0.0.1", "127.0.0.1:8001", None),
    ("127.0.0.1", "127.0.0.1:8001", "http://127.0.0.1:3001"),
    ("127.0.0.1", "localhost:8001", "http://localhost:3001"),
    ("127.0.0.1", "localhost", None),
    ("127.0.0.1", "127.0.0.1", None),
    ("::1", "[::1]:8001", "http://localhost:3001"),
    ("::1", "[::1]", None),
])
def test_trusted_tokenless_session(presentation_settings, peer, host, origin):
    headers = {"Host": host, "Sec-Fetch-Site": "same-origin"}
    if origin is not None:
        headers["Origin"] = origin
    with local_client(presentation_settings, client=(peer, 50000)) as client:
        response = client.get("/api/session", headers=headers)
        assert response.status_code == 200
        assert response.json() == {"subject": "local-presentation", "role": "Radiologist", "presentationMode": True}
        assert response.headers["cache-control"] == "no-store"
        assert client.get("/api/audit/events", headers=headers).status_code == 403


@pytest.mark.parametrize("peer", [("192.0.2.1", 50000), ("testclient", 50000), ("::ffff:127.0.0.1", 50000), None])
def test_remote_or_missing_client_is_rejected(presentation_settings, peer):
    with local_client(presentation_settings, client=peer) as client:
        response = client.get("/api/session", headers={"X-Forwarded-For": "127.0.0.1", "Origin": "http://localhost:3001"})
        assert response.status_code == 403


@pytest.mark.parametrize("host", [
    "testserver", "example.test", "localhost.example.test", "127.0.0.1.example.test", "0.0.0.0:8001",
    "example.test@localhost:8001", "http://localhost:8001", "[::1].example.test:8001", "localhost:65536", "localhost:0", "",
])
def test_non_loopback_or_malformed_host_is_rejected(presentation_settings, host):
    with local_client(presentation_settings) as client:
        assert client.get("/api/session", headers={"Host": host}).status_code == 403


@pytest.mark.parametrize("headers", [
    {"Origin": "null"},
    {"Origin": "https://localhost:3001"},
    {"Origin": "http://localhost:3000"},
    {"Origin": "http://127.0.0.1:3000"},
    {"Origin": "http://localhost:3001/"},
    {"Origin": "http://example.test"},
    {"Origin": ""},
    {"Sec-Fetch-Site": "cross-site"},
    {"Origin": "http://localhost:3001", "Sec-Fetch-Site": "cross-site"},
    [("Origin", "http://localhost:3001"), ("Origin", "http://example.test")],
    [("Host", "127.0.0.1:8001"), ("Host", "example.test")],
    [("Sec-Fetch-Site", "same-origin"), ("Sec-Fetch-Site", "cross-site")],
])
def test_untrusted_browser_request_is_rejected(presentation_settings, headers):
    with local_client(presentation_settings) as client:
        assert client.get("/api/session", headers=headers).status_code == 403
        assert client.post("/api/cases", headers=headers, json={"patientPseudoId": "synthetic", "modality": "XR"}).status_code == 403


@pytest.mark.parametrize("header", ["Bearer not-a-token", "Bearer", "Bearer ", "Basic invalid", ""])
def test_invalid_authorization_never_falls_back_to_presentation(presentation_settings, header):
    with local_client(presentation_settings) as client:
        response = client.get("/api/session", headers={"Authorization": header})
        assert response.status_code == 401
        assert response.headers["www-authenticate"] == "Bearer"


def test_jwt_subject_role_and_expiry_remain_authoritative(presentation_settings, synthetic_case):
    with local_client(presentation_settings) as client:
        for overrides in ({"exp": 1}, {"sub": "local-presentation"}, {"aud": "wrong"}):
            assert client.get("/api/session", headers=authorization(presentation_settings, **overrides)).status_code == 401
        headers = authorization(presentation_settings, "research", role="Radiologist", presentationMode=True)
        response = client.get("/api/session", headers=headers)
        assert response.status_code == 200
        assert response.json() == {"subject": "research", "role": "Researcher"}
        assert SessionDTO.model_validate(response.json()).presentationMode is False
        assert client.post("/api/cases", headers=headers, json=synthetic_case).status_code == 403


def test_synthetic_crud_export_is_isolated_from_normal_records(configured_environment, monkeypatch, synthetic_case):
    normal_config = Settings.from_env()
    with local_client(normal_config) as client:
        original = client.post("/api/cases", headers=authorization(normal_config), json=synthetic_case)
        assert original.status_code == 201
        original_case = original.json()
    original_database = (configured_environment / "normal.db").read_bytes()

    monkeypatch.setenv("PRESENTATION_MODE", "true")
    config = Settings.from_env()
    with local_client(config) as client:
        assert client.get("/api/cases").json() == []
        assert client.get("/api/cases/" + original_case["id"]).status_code == 404
        body = {**synthetic_case, "patientPseudoId": "synthetic-presentation-only"}
        response = client.post("/api/cases", json=body, headers={"Origin": "http://localhost:3001"})
        assert response.status_code == 201
        case = response.json()
        url = "/api/cases/" + case["id"]
        assert client.get(url).json() == case
        updated = client.put(url, json={**body, "reportText": "Synthetic presentation edit", "expectedRevision": 1})
        assert updated.status_code == 200
        assert updated.json()["revision"] == 2
        assert client.get(url + "/export").json() == updated.json()
        assert client.get("/api/cases").json() == [updated.json()]
    assert (configured_environment / "normal.db").read_bytes() == original_database
    with local_client(normal_config) as client:
        assert client.get("/api/cases", headers=authorization(normal_config)).json() == [original_case]
        assert client.get(url, headers=authorization(normal_config)).status_code == 404


def test_presentation_cannot_sign_or_amend_but_registered_reviewers_can(presentation_settings, synthetic_case):
    with local_client(presentation_settings) as client:
        response = client.post("/api/cases", json=synthetic_case)
        assert response.status_code == 201
        case = response.json()
        url = "/api/cases/" + case["id"]
        assert client.post(url + "/sign", json={"expectedRevision": 1}).status_code == 403
        amendment = {"expectedRevision": 1, "reason": "Synthetic correction"}
        assert client.post(url + "/amend", json=amendment).status_code == 403
        assert client.get(url).json() == case
        for subject in ("rad-one", "rad-two"):
            result = client.post(url + "/sign", json={"expectedRevision": 1}, headers=authorization(presentation_settings, subject))
            assert result.status_code == 200
        assert result.json()["state"] == "VERIFIED"
        assert client.post(url + "/amend", json=amendment).status_code == 403
        assert client.get(url).json() == result.json()
        assert client.post(url + "/amend", json=amendment, headers=authorization(presentation_settings)).status_code == 200


def test_synthetic_pdf_upload_uses_existing_auth_dependency(presentation_settings, monkeypatch):
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    stream = io.BytesIO()
    writer.write(stream)
    content = stream.getvalue()
    result = {"method": "rule-based-report-extraction", "clinicallyValidated": False,
              "sourceSha256": hashlib.sha256(content).hexdigest(), "pages": [], "findings": [], "warnings": []}

    def extract_pdf(payload):
        assert payload == content
        return result

    monkeypatch.setattr(report_extraction, "extract_pdf", extract_pdf)
    with local_client(presentation_settings) as client:
        response = client.post("/api/mri/report", files={"file": ("synthetic.pdf", content, "application/pdf")},
                               headers={"Origin": "http://127.0.0.1:3001", "Sec-Fetch-Site": "same-origin"})
        assert response.status_code == 200
        assert response.json() == result
