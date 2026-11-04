import hashlib
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.services.radiology_inference import RadiologyAdapter
from app.services.mri_nlp import MRIAdapter, ENTITY_TYPES, EXPECTED_LABELS
from conftest import authorization


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def workspace(service):
    return Path(service[2].database_url.removeprefix("sqlite:///")) .parent


def test_yolo_pins_real_execution_contract_and_no_measurements(local_service, monkeypatch):
    directory = workspace(local_service)
    weights = directory / "trusted.pt"
    weights.write_bytes(b"mock artifact, not a trained model")
    manifest = directory / "labels.json"
    manifest.write_text(json.dumps({"task": "fracture_detection", "taskTrained": True, "modelName": "test-only", "trainingReference": "synthetic-test", "validationReference": "test-only-not-clinical", "labels": {"0": {"className": "test-class", "label": "Synthetic detection", "boneId": "C6", "fmaId": "FMA:123", "ontologyVerified": True, "ontologySourceReference": "mock-test-only"}}}))
    for name, value in {"LOCAL_MODELS_ENABLED": "true", "YOLO_WEIGHTS_PATH": str(weights), "YOLO_WEIGHTS_SHA256": digest(weights), "YOLO_METADATA_PATH": str(manifest), "YOLO_METADATA_SHA256": digest(manifest)}.items():
        monkeypatch.setenv(name, value)
    calls = []
    class Tensor:
        def __init__(self, values): self.values = values
        def tolist(self): return self.values
    class Boxes:
        xyxy, conf, cls = Tensor([[20, 10, 80, 40]]), Tensor([0.8]), Tensor([0])
        def __len__(self): return 1
    class Model:
        task, names = "detect", {0: "test-class"}
        def predict(self, **kwargs):
            calls.append(kwargs)
            return [SimpleNamespace(boxes=Boxes())]
    monkeypatch.setitem(sys.modules, "ultralytics", SimpleNamespace(YOLO=lambda *args, **kwargs: Model()))
    monkeypatch.setattr(RadiologyAdapter, "_decode", staticmethod(lambda content: SimpleNamespace(size=(100, 50), close=lambda: None)))
    adapter = RadiologyAdapter()
    result = adapter.predict(b"synthetic")
    assert set(result) == {"modelSha256", "detections"}
    finding = result["detections"][0]
    assert finding["boundingBox"] == [0.2, 0.2, 0.8, 0.8]
    assert finding["displacementMm"] is None and finding["aoOtaCode"] is None
    assert calls[0]["save"] is False and calls[0]["device"] == "cpu"
    monkeypatch.setenv("YOLO_WEIGHTS_SHA256", "0" * 64)
    with pytest.raises(HTTPException) as failure:
        RadiologyAdapter().predict(b"synthetic")
    assert failure.value.status_code == 503


def test_mri_local_safetensors_pipeline_and_base_model_rejection(local_service, monkeypatch):
    directory = workspace(local_service) / "ner"
    directory.mkdir()
    config = {"architectures": ["BertForTokenClassification"], "id2label": {str(index): label for index, label in enumerate(sorted(EXPECTED_LABELS))}}
    (directory / "config.json").write_text(json.dumps(config))
    (directory / "tokenizer.json").write_text("{}")
    (directory / "model.safetensors").write_bytes(b"mock-safetensors-not-real-weights")
    def pin_manifest():
        manifest = {"task": "mri_token_classification", "taskTrained": True, "modelName": "test-only", "trainingReference": "test", "validationReference": "test-only-not-clinical", "entityTypes": ENTITY_TYPES, "files": {path.name: digest(path) for path in directory.iterdir() if path.name != "model_manifest.json"}}
        (directory / "model_manifest.json").write_text(json.dumps(manifest))
        monkeypatch.setenv("MRI_MANIFEST_SHA256", digest(directory / "model_manifest.json"))
    pin_manifest()
    monkeypatch.setenv("LOCAL_MODELS_ENABLED", "true")
    monkeypatch.setenv("MRI_MODEL_DIR", str(directory))
    calls = []
    class Tokenizer:
        is_fast, model_max_length = True, 512
        def __call__(self, text, **kwargs): return {"input_ids": [1, 2, 3]}
    def tokenizer_load(path, **kwargs):
        calls.append(kwargs)
        return Tokenizer()
    def model_load(path, **kwargs):
        calls.append(kwargs)
        return SimpleNamespace(config=SimpleNamespace(id2label=config["id2label"], max_position_embeddings=512))
    monkeypatch.setitem(sys.modules, "transformers", SimpleNamespace(AutoTokenizer=SimpleNamespace(from_pretrained=tokenizer_load), AutoModelForTokenClassification=SimpleNamespace(from_pretrained=model_load), pipeline=lambda *args, **kwargs: lambda text: [{"entity_group": "ANATOMY", "start": 0, "end": 4, "score": 0.9}]))
    monkeypatch.setitem(sys.modules, "safetensors", SimpleNamespace())
    result = MRIAdapter().extract("Bone synthetic only")
    assert set(result) == {"modelSha256", "entities"}
    assert result["entities"] == [{"text": "Bone", "start": 0, "end": 4, "label": "ANATOMY", "score": 0.9, "radlexId": None, "boneId": None}]
    assert all(call["local_files_only"] is True and call["trust_remote_code"] is False for call in calls)
    assert calls[1]["use_safetensors"] is True
    config["id2label"] = {"0": "LABEL_0", "1": "LABEL_1"}
    (directory / "config.json").write_text(json.dumps(config))
    pin_manifest()
    with pytest.raises(HTTPException) as failure:
        MRIAdapter().extract("Synthetic")
    assert failure.value.status_code == 503 and len(calls) == 2


def test_model_api_contract_auth_audit_and_no_automatic_case_edits(local_service, synthetic_case, synthetic_png):
    client, app, config = local_service
    case = client.post("/api/cases", headers=authorization(config), json=synthetic_case).json()
    provenance = {"task": "fracture_detection", "modelSha256": "a" * 64, "manifestSha256": "b" * 64}
    app.state.radiology = SimpleNamespace(configured=True, provenance=provenance, predict=lambda content: {"modelSha256": "a" * 64, "detections": []})
    files = {"file": ("unused-name.png", synthetic_png, "image/png")}
    assert client.post("/api/radiology/infer", headers=authorization(config, "research"), files=files).status_code == 403
    result = client.post("/api/radiology/infer", headers=authorization(config), files=files, data={"caseId": case["id"]})
    assert result.status_code == 200 and set(result.json()) == {"modelSha256", "detections"}
    app.state.mri = SimpleNamespace(configured=True, provenance={**provenance, "task": "mri_token_classification"}, extract=lambda text: {"modelSha256": "a" * 64, "entities": []})
    assert client.post("/api/mri/extract", headers=authorization(config), json={"reportText": "SYNTHETIC-SECRET-MARKER", "caseId": case["id"]}).status_code == 410
    events = client.get("/api/audit/events", headers=authorization(config, "compliance")).json()
    model_events = [event["payload"] for event in events if event["payload"]["action"] == "MODEL_INFER"]
    assert len(model_events) == 1 and all(event["model"]["modelSha256"] == "a" * 64 for event in model_events)
    assert "SYNTHETIC-SECRET-MARKER" not in json.dumps(events)
    assert client.get("/api/cases/" + case["id"], headers=authorization(config)).json() == case
    assert client.get("/api/health").json()["radiologyConfigured"] is True
