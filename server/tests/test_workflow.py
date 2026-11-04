from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from sqlalchemy import select

from app.models.case_record import AuditEvent, CaseRecord
from conftest import authorization


def test_case_contract_encrypted_persistence_and_export(local_service, synthetic_case):
    client, app, config = local_service
    headers = authorization(config)
    created = client.post("/api/cases", headers=headers, json=synthetic_case)
    assert created.status_code == 201, created.text
    case = created.json()
    assert set(case) == set(synthetic_case) | {"id", "state", "revision", "signatures", "createdAt", "updatedAt"}
    assert set(case["findings"][0]) == {"id", "boneId", "fmaId", "label", "confidence", "boundingBox", "displacementMm", "aoOtaCode", "radlexId", "reportEvidence", "imageEvidence", "manualImageEvidence"}
    assert case["revision"] == 1 and case["state"] == "PRELIMINARY" and case["signatures"] == []
    assert datetime.fromisoformat(case["createdAt"].replace("Z", "+00:00")).utcoffset().total_seconds() == 0
    case_id = case["id"]
    assert client.get("/api/cases", headers=headers).json() == [case]
    assert client.get(f"/api/cases/{case_id}", headers=headers).json() == case
    assert client.get(f"/api/cases/{case_id}/export").status_code == 401
    assert client.get(f"/api/cases/{case_id}/export", headers=authorization(config, "compliance")).status_code == 403
    exported = client.get(f"/api/cases/{case_id}/export", headers=authorization(config, "research"))
    assert exported.json() == case
    assert exported.headers["cache-control"] == "no-store"
    with app.state.db.transaction() as session:
        row = session.get(CaseRecord, case_id)
        for value in (row.patient_pseudo_id, row.dicom_uid, row.report_text, row.bone_ids, row.findings):
            assert value.startswith("v1:")
            assert synthetic_case["patientPseudoId"] not in value
            assert synthetic_case["reportText"] not in value
        events = [event.payload for event in session.scalars(select(AuditEvent))]
        assert any('"action":"EXPORT"' in event for event in events)
        assert not any(synthetic_case["reportText"] in event for event in events)
    result = client.get("/api/audit/verify", headers=authorization(config, "compliance")).json()
    assert result["valid"] is True
    assert isinstance(result["entries"], int) and result["entries"] == result["checkedEvents"]
    assert client.get("/api/cases/not-a-uuid", headers=headers).status_code == 422
    assert client.get("/api/cases/00000000-0000-0000-0000-000000000001", headers=headers).status_code == 404


def test_dual_signature_revision_amendment(local_service, synthetic_case):
    client, _, config = local_service
    one, two, researcher = authorization(config), authorization(config, "rad-two"), authorization(config, "research")
    case = client.post("/api/cases", headers=one, json=synthetic_case).json()
    url = "/api/cases/" + case["id"]
    assert client.put(url, headers=one, json=synthetic_case).status_code == 422
    assert client.post(url + "/sign", headers=one, json={}).status_code == 422
    assert client.post(url + "/amend", headers=one, json={"reason": "Synthetic correction"}).status_code == 422
    assert client.post(url + "/sign", headers=one, json={"expectedRevision": True}).status_code == 422
    assert client.post(url + "/sign", headers=researcher, json={"expectedRevision": 1}).status_code == 403
    first = client.post(url + "/sign", headers=one, json={"expectedRevision": 1}).json()
    assert first["state"] == "PRELIMINARY" and len(first["signatures"]) == 1
    unchanged = client.put(url, headers=one, json={**synthetic_case, "expectedRevision": 1}).json()
    assert unchanged["revision"] == 1 and unchanged["signatures"] == first["signatures"]
    assert client.post(url + "/sign", headers=one, json={"expectedRevision": 1}).status_code == 409
    changed = {**synthetic_case, "reportText": "Synthetic revised text", "expectedRevision": 1}
    edited = client.put(url, headers=one, json=changed).json()
    assert edited["revision"] == 2 and edited["signatures"] == []
    assert client.post(url + "/sign", headers=two, json={"expectedRevision": 1}).status_code == 409
    assert client.put(url, headers=one, json=changed).status_code == 409
    assert client.post(url + "/sign", headers=one, json={"expectedRevision": 2}).status_code == 200
    verified = client.post(url + "/sign", headers=two, json={"expectedRevision": 2}).json()
    assert verified["state"] == "VERIFIED"
    assert {sig["reviewerId"] for sig in verified["signatures"]} == {"rad-one", "rad-two"}
    assert all(set(sig) == {"reviewerId", "revision", "signedAt"} for sig in verified["signatures"])
    assert {sig["revision"] for sig in verified["signatures"]} == {2}
    assert client.put(url, headers=one, json={**changed, "expectedRevision": 2}).status_code == 409
    assert client.post(url + "/amend", headers=one, json={"expectedRevision": 1, "reason": "Synthetic correction"}).status_code == 409
    assert client.post(url + "/amend", headers=one, json={"expectedRevision": 2, "reason": "   "}).status_code == 422
    amended = client.post(url + "/amend", headers=one, json={"expectedRevision": 2, "reason": "Synthetic correction"}).json()
    assert amended["state"] == "AMENDED" and amended["revision"] == 3 and amended["signatures"] == []
    assert client.post(url + "/sign", headers=one, json={"expectedRevision": 3}).json()["state"] == "AMENDED"
    assert client.post(url + "/sign", headers=two, json={"expectedRevision": 3}).json()["state"] == "VERIFIED"


def test_no_findings_and_invalid_payloads(local_service, synthetic_case):
    client, _, config = local_service
    headers = authorization(config)
    empty = {**synthetic_case, "findings": []}
    case = client.post("/api/cases", headers=headers, json=empty).json()
    assert client.post("/api/cases/" + case["id"] + "/sign", headers=headers, json={"expectedRevision": 1}).status_code == 409
    assert client.post("/api/cases", headers=headers, json={**synthetic_case, "modality": "US"}).status_code == 422
    bad_finding = {**synthetic_case["findings"][0], "confidence": 1.2}
    assert client.post("/api/cases", headers=headers, json={**synthetic_case, "findings": [bad_finding]}).status_code == 422
    bad_finding = {**synthetic_case["findings"][0], "boundingBox": [3, 2, 1, 4]}
    assert client.post("/api/cases", headers=headers, json={**synthetic_case, "findings": [bad_finding]}).status_code == 422
    response = client.post("/api/cases", headers=headers, json={**synthetic_case, "findings": synthetic_case["findings"] * 2})
    assert response.status_code == 422 and "Synthetic manually entered finding" not in response.text


def test_racing_edit_only_one_revision_wins(local_service, synthetic_case):
    client, _, config = local_service
    headers = authorization(config)
    case = client.post("/api/cases", headers=headers, json=synthetic_case).json()
    url = "/api/cases/" + case["id"]

    def edit(index):
        return client.put(url, headers=headers, json={**synthetic_case, "reportText": f"Synthetic edit {index}", "expectedRevision": 1}).status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(edit, (1, 2)))
    assert sorted(results) == [200, 409]
    assert client.get("/api/audit/verify", headers=authorization(config, "compliance")).json()["valid"]


def test_racing_distinct_signatures_and_concurrent_audit_reads(local_service, synthetic_case):
    client, _, config = local_service
    case = client.post("/api/cases", headers=authorization(config), json=synthetic_case).json()
    url = "/api/cases/" + case["id"]

    def sign(subject):
        return client.post(url + "/sign", headers=authorization(config, subject), json={"expectedRevision": 1}).status_code

    with ThreadPoolExecutor(max_workers=4) as executor:
        assert list(executor.map(sign, ("rad-one", "rad-two"))) == [200, 200]
        assert list(executor.map(lambda _: client.get(url, headers=authorization(config)).status_code, range(8))) == [200] * 8
    assert client.get(url, headers=authorization(config)).json()["state"] == "VERIFIED"
    assert client.get("/api/audit/verify", headers=authorization(config, "compliance")).json()["valid"]


def test_unconfigured_ai_authentication_and_limits(local_service, synthetic_png):
    client, _, config = local_service
    headers = authorization(config)
    assert client.post("/api/radiology/infer").status_code == 401
    assert client.post("/api/radiology/infer", headers=authorization(config, "research")).status_code == 403
    assert client.post("/api/radiology/infer", headers=headers, files={"file": ("synthetic.png", synthetic_png, "image/png")}).status_code == 503
    assert client.post("/api/mri/extract", headers=headers, json={"reportText": "Synthetic MRI text"}).status_code == 410
    assert client.post("/api/mri/extract", headers=headers, json={"file": "not-text"}).status_code == 410
    assert client.post("/api/mri/extract", headers=headers, json={"reportText": "x" * 20001}).status_code == 410
    assert client.post("/api/cases", headers=headers, content=b"x" * 1048577).status_code == 413


def test_openapi_exact_contract(local_service):
    client, _, _ = local_service
    schema = client.get("/openapi.json").json()
    props = schema["components"]["schemas"]["CaseDTO"]["properties"]
    assert set(props) == {"id", "patientPseudoId", "dicomSeriesInstanceUid", "reportText", "modality", "boneIds", "findings", "state", "revision", "signatures", "createdAt", "updatedAt"}
    assert set(schema["components"]["schemas"]["Finding-Output"]["properties"]) == {"id", "boneId", "fmaId", "label", "confidence", "boundingBox", "displacementMm", "aoOtaCode", "radlexId", "reportEvidence", "imageEvidence", "manualImageEvidence"}
    assert set(schema["components"]["schemas"]["SignatureDTO"]["properties"]) == {"reviewerId", "revision", "signedAt"}
    for model in ("UpdateCase", "RevisionRequest", "AmendRequest"):
        assert "expectedRevision" in schema["components"]["schemas"][model]["required"]
    assert "/api/cases/{case_id}/export" in schema["paths"]


def test_chunked_body_limit_and_opt_in_cors(local_service):
    from dataclasses import replace
    from fastapi.testclient import TestClient
    from app.main import create_app
    client, _, config = local_service

    def chunks():
        for _ in range(17):
            yield b"x" * 65536

    assert client.post("/api/cases", headers=authorization(config), content=chunks()).status_code == 413
    assert "access-control-allow-origin" not in client.get("/api/health", headers={"Origin": "http://localhost:3000"}).headers
    with TestClient(create_app(replace(config, dev_cors=True))) as cors_client:
        allowed = cors_client.options("/api/cases", headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "Authorization,Content-Type"})
        assert allowed.status_code == 200
        assert allowed.headers["access-control-allow-origin"] == "http://localhost:3000"
        denied = cors_client.options("/api/cases", headers={"Origin": "https://untrusted.invalid", "Access-Control-Request-Method": "POST"})
        assert denied.status_code == 400 and "access-control-allow-origin" not in denied.headers
