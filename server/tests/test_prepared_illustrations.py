import hashlib
import io
import json
from dataclasses import replace
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pydantic import ValidationError

from app.services import prepared_illustrations as prepared
from conftest import authorization

ATTACHMENTS = Path(r"C:\Users\HP\AppData\Roaming\Code\agentSessionData\e892b02c-6bc6-4cb6-a173-042e8bb431c2\attachments")
ORIGINAL_IDS = (
    "4d4b9975", "8acb52f3", "08fbeda1", "ddb96677", "ba95c62b",
    "71851627", "5953067d", "94cb284f", "6d0b0a3f", "6669a73d",
)


@pytest.fixture
def original_pngs():
    if not ATTACHMENTS.is_dir():
        pytest.skip("Original user attachments are not available on this machine")
    paths = []
    for prefix in ORIGINAL_IDS:
        directories = list(ATTACHMENTS.glob(prefix + "-*"))
        assert len(directories) == 1
        images = list(directories[0].glob("*.png"))
        assert len(images) == 1
        paths.append(images[0])
    return paths


@pytest.fixture
def prepared_png(synthetic_png, monkeypatch):
    value = prepared.catalog()[0].model_dump(mode="json")
    value["sourceSha256"] = hashlib.sha256(synthetic_png).hexdigest()
    entry = prepared.PreparedIllustration.model_validate(value)
    monkeypatch.setattr(prepared, "catalog", lambda: (entry,))
    return synthetic_png


def test_catalog_valid_and_uncertainty_explicit():
    entries = prepared.catalog()
    assert len(entries) == len({entry.sourceSha256 for entry in entries}) == 10
    assert entries == tuple(prepared.PreparedIllustration.model_validate(value) for value in json.loads(prepared.CATALOG_PATH.read_text(encoding="utf-8")))
    for entry in entries:
        assert "Approximate" in entry.title
        assert any("not a prediction or diagnosis" in limitation for limitation in entry.limitations)
        assert any("not measured fracture geometry or exact 3D" in limitation for limitation in entry.limitations)
    ribs = next(entry for entry in entries if "RIB_1_RIGHT" in entry.boneIds)
    assert set(ribs.boneIds) == {f"RIB_{number}_RIGHT" for number in range(1, 13)}
    assert ribs.targetBoneId is None
    assert any("Rib number not established" in limitation for limitation in ribs.limitations)
    skull = next(entry for entry in entries if "PARIETAL_RIGHT" in entry.boneIds)
    assert skull.boneIds == ["FRONTAL", "PARIETAL_RIGHT"]
    assert any("not certified involved bones" in limitation for limitation in skull.limitations)


@pytest.mark.parametrize("changes", [
    {"sourceSha256": "not-a-hash"},
    {"boneIds": ["UNKNOWN_BONE"]},
    {"boneIds": ["SCAPULA_LEFT", "SCAPULA_LEFT"]},
    {"targetBoneId": "TIBIA_RIGHT"},
    {"fracture": {"positionFraction": [0.5, 1.1, 0.5], "angleDegrees": 20, "size": 0.3}},
    {"fracture": {"positionFraction": [0.5, 0.5, 0.5], "angleDegrees": float("nan"), "size": 0.3}},
    {"fracture": {"positionFraction": [0.5, 0.5, 0.5], "angleDegrees": 20, "size": 0.7}},
])
def test_catalog_rejects_invalid_metadata(changes):
    with pytest.raises(ValidationError):
        prepared.PreparedIllustration.model_validate({**prepared.catalog()[0].model_dump(), **changes})


def test_default_target_and_explicit_null():
    value = prepared.catalog()[0].model_dump()
    del value["targetBoneId"]
    assert prepared.PreparedIllustration.model_validate(value).targetBoneId == value["boneIds"][0]
    assert prepared.PreparedIllustration.model_validate({**value, "targetBoneId": None}).targetBoneId is None


def test_all_ten_original_bytes_match_without_modification(original_pngs):
    original_hashes = []
    for path, entry in zip(original_pngs, prepared.catalog(), strict=True):
        content = path.read_bytes()
        original_hashes.append(hashlib.sha256(content).hexdigest())
        assert original_hashes[-1] == entry.sourceSha256
        result = prepared.lookup(content)
        assert result["matched"] is True
        assert result["sourceSha256"] == entry.sourceSha256
        assert result["boneIds"] == entry.boneIds
    assert [hashlib.sha256(path.read_bytes()).hexdigest() for path in original_pngs] == original_hashes
    assert len(set(original_hashes)) == 10


def test_all_ten_original_uploads_match_with_renamed_filenames(original_pngs, local_service):
    client, _, config = local_service
    for path in original_pngs:
        content = path.read_bytes()
        response = client.post("/api/radiology/prepared", files={"file": ("renamed.png", content, "image/png")}, headers=authorization(config))
        assert response.status_code == 200 and response.json() == prepared.lookup(content)


def test_exact_match_unknown_and_returned_metadata_is_not_shared(prepared_png):
    matched = prepared.lookup(prepared_png)
    assert matched["label"] == "Prepared illustration—not AI reconstruction"
    assert matched["method"] == "prepared-image-illustration"
    assert matched["clinicallyValidated"] is False
    matched["boneIds"].clear()
    assert prepared.lookup(prepared_png)["boneIds"]
    for changed in (prepared_png + b"changed-content", b"unknown"):
        result = prepared.lookup(changed)
        assert result == {
            "matched": False, "method": prepared.METHOD, "clinicallyValidated": False,
            "sourceSha256": hashlib.sha256(changed).hexdigest(), "message": prepared.UNMATCHED_MESSAGE,
        }


def test_changed_pixel_and_reencoded_png_do_not_match(prepared_png):
    with Image.open(io.BytesIO(prepared_png)) as image:
        reencoded = io.BytesIO()
        image.save(reencoded, format="PNG", compress_level=0)
        image.putpixel((0, 0), (255, 0, 0))
        changed = io.BytesIO()
        image.save(changed, format="PNG")
    for content in (reencoded.getvalue(), changed.getvalue()):
        assert content != prepared_png
        assert prepared.lookup(content)["matched"] is False


def test_route_auth_policy_case_audit_and_no_clinical_mutation(local_service, synthetic_case, prepared_png):
    client, _, config = local_service
    files = {"file": ("private-original-name.png", prepared_png, "image/png")}
    assert client.post("/api/radiology/prepared", files=files).status_code == 401
    assert client.post("/api/radiology/prepared", files=files, headers=authorization(config, "research")).status_code == 403
    headers = authorization(config)
    case = client.post("/api/cases", headers=headers, json=synthetic_case).json()
    response = client.post("/api/radiology/prepared", files=files, data={"caseId": case["id"]}, headers=headers)
    assert response.status_code == 200 and response.json()["matched"] is True
    assert client.get("/api/cases/" + case["id"], headers=headers).json() == case
    assert client.post("/api/radiology/prepared", files=files, data={"caseId": str(uuid4())}, headers=headers).status_code == 404
    assert client.post("/api/radiology/prepared", files=files, data={"caseId": "invalid"}, headers=headers).status_code == 422
    for name, content, mime in (
        ("x.jpg", b"\xff\xd8\xff", "image/jpeg"),
        ("x.png", b"\xff\xd8\xff", "image/png"),
        ("x.png", prepared_png, "image/jpeg"),
    ):
        assert client.post("/api/radiology/prepared", files={"file": (name, content, mime)}, headers=headers).status_code == 415
    assert client.post("/api/radiology/prepared", files={"file": ("x.png", b"", "image/png")}, headers=headers).status_code == 422
    assert client.post("/api/radiology/prepared", files={"file": ("x.png", b"x" * (10 * 1024 * 1024 + 1), "image/png")}, headers=headers).status_code == 413
    forged = client.post("/api/radiology/prepared", files={"file": ("Annotated Left Scapula Fracture X-rays.png", prepared_png + b"unknown", "image/png")}, headers=headers)
    assert forged.status_code == 200 and forged.json()["matched"] is False
    assert "fracture" not in forged.json() and "boneIds" not in forged.json()
    events = client.get("/api/audit/events", headers=authorization(config, "compliance")).json()
    prepared_events = [event["payload"] for event in events if event["payload"]["action"] == "PREPARED_ILLUSTRATION"]
    assert len(prepared_events) == 1
    assert prepared_events[0]["caseId"] == case["id"]
    assert prepared_events[0]["revision"] == case["revision"]
    assert "model" not in prepared_events[0] and "report" not in prepared_events[0]
    assert "private-original-name" not in str(events)


def test_route_uses_existing_loopback_presentation_principal(local_service, prepared_png):
    _, app, config = local_service
    app.state.settings = replace(config, presentation_mode=True)
    client = TestClient(app, base_url="http://127.0.0.1:8001", client=("127.0.0.1", 50000))
    try:
        files = {"file": ("renamed.png", prepared_png, "image/png")}
        response = client.post("/api/radiology/prepared", files=files)
        assert response.status_code == 200 and response.json()["matched"] is True
        assert client.post("/api/radiology/prepared", files=files, headers={"Authorization": "Bearer invalid"}).status_code == 401
        assert client.post("/api/radiology/prepared", files=files, headers={"Origin": "https://untrusted.example"}).status_code == 403
        events = client.get("/api/audit/events", headers=authorization(config, "compliance")).json()
        event = next(event["payload"] for event in events if event["payload"]["action"] == "PREPARED_ILLUSTRATION")
        assert event["actor"] == "local-presentation" and event["caseId"] is None
    finally:
        client.close()
        app.state.settings = config
