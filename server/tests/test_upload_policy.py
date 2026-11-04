import io
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from PIL import Image

from app.services.radiology_inference import RadiologyAdapter
from conftest import authorization


@pytest.fixture
def jpeg_bytes():
    stream = io.BytesIO()
    with Image.new("RGB", (16, 16), "white") as image:
        image.save(stream, format="JPEG")
    return stream.getvalue()


@pytest.mark.parametrize("route", ["/api/radiology/infer", "/api/radiology/experimental"])
def test_only_actual_named_png_uploads_reach_radiology(local_service, synthetic_png, jpeg_bytes, route):
    client, app, config = local_service
    calls = []
    def predict(content):
        calls.append(content)
        return {"modelSha256": "a" * 64, "detections": []}
    adapter = SimpleNamespace(predict=predict, provenance={"task": "synthetic-upload-test", "modelSha256": "a" * 64, "manifestSha256": "b" * 64})
    if route.endswith("experimental"):
        app.state.experimental_radiology = adapter
    else:
        app.state.radiology = adapter
    rejected = [
        ("image.jpg", jpeg_bytes, "image/jpeg"), ("image.jpeg", jpeg_bytes, "image/jpeg"),
        ("renamed.png", jpeg_bytes, "image/png"), ("image.png", synthetic_png, "image/jpeg"),
        ("image.jpg", synthetic_png, "image/png"), ("image.png.exe", synthetic_png, "image/png"),
        ("scan.dcm", b"\0" * 128 + b"DICM", "application/dicom"),
        ("report.pdf", b"%PDF-1.7\n", "application/pdf"),
        ("report.docx", b"PK\x03\x04", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        ("image.png", synthetic_png, "application/octet-stream"),
    ]
    for upload in rejected:
        result = client.post(route, headers=authorization(config), files={"file": upload})
        assert result.status_code == 415, (upload[0], result.status_code)
    assert not calls
    result = client.post(route, headers=authorization(config), files={"file": ("actual.PNG", synthetic_png, "image/png")})
    assert result.status_code == 200 and calls == [synthetic_png]


def test_png_decoder_rejects_jpeg_even_without_upload_metadata(jpeg_bytes, synthetic_png):
    with pytest.raises(HTTPException) as error:
        RadiologyAdapter._decode(jpeg_bytes)
    assert error.value.status_code == 422
    image = RadiologyAdapter._decode(synthetic_png)
    try:
        assert image.size == (16, 16)
    finally:
        image.close()


def test_only_actual_named_pdf_uploads_reach_report_processor(local_service, monkeypatch, synthetic_png, jpeg_bytes):
    client, app, config = local_service
    calls = []
    from app.services import report_extraction
    def extract(content):
        calls.append(content)
        return report_extraction.extract_text("Findings: Acute C6 fracture.")
    monkeypatch.setattr(report_extraction, "extract_pdf", extract)
    rejected = [
        ("x.png", synthetic_png, "image/png"), ("x.jpg", jpeg_bytes, "image/jpeg"),
        ("x.docx", b"PK\x03\x04", "application/pdf"),
        ("renamed.pdf", b"PK\x03\x04", "application/pdf"),
        ("renamed.pdf", synthetic_png, "application/pdf"),
        ("renamed.png", b"%PDF-1.7\n", "application/pdf"),
        ("x.pdf", b"%PDF-1.7\n", "application/octet-stream"),
        ("x.dcm", b"\0" * 128 + b"DICM", "application/dicom"),
    ]
    for upload in rejected:
        result = client.post("/api/mri/report", headers=authorization(config), files={"file": upload})
        assert result.status_code == 415
    assert not calls
    content = b"%PDF-1.7\nsynthetic signature-only fixture for a mocked processor"
    result = client.post("/api/mri/report", headers=authorization(config), files={"file": ("actual.PDF", content, "application/pdf")})
    assert result.status_code == 200 and calls == [content]


@pytest.mark.parametrize("route", ["/api/mri/extract", "/api/mri/report-text"])
def test_pasted_text_routes_are_disabled_not_hidden_only(local_service, monkeypatch, route):
    client, app, config = local_service
    def unexpected(*args, **kwargs):
        pytest.fail("Disabled text route invoked a processor")
    monkeypatch.setattr(app.state.mri, "extract", unexpected)
    monkeypatch.setattr("app.services.report_extraction.extract_text", unexpected)
    result = client.post(route, headers=authorization(config), json={"reportText": "Findings: C6 fracture."})
    assert result.status_code == 410
    assert "PDF" in result.json()["detail"]
    assert route not in client.get("/openapi.json").json()["paths"]


def test_upload_paths_do_not_accept_json_instead_of_files(local_service):
    client, _, config = local_service
    for route in ("/api/radiology/infer", "/api/radiology/experimental", "/api/mri/report"):
        result = client.post(route, headers=authorization(config), json={"reportText": "Synthetic", "image": "base64"})
        assert result.status_code == 422
