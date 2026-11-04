"""Opt-in trusted-local YOLO detection; never infer physical measurements from pixels."""
import io
import math
import os
import re
import threading
import warnings
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException

from app.schemas import Finding
from app.services.bone_registry import valid_bone
from app.services.model_artifacts import enabled, metadata, pinned, unavailable


class RadiologyAdapter:
    def __init__(self):
        self._lock = threading.Lock()
        self._model = None
        self._labels = None
        self.provenance = None

    @property
    def configured(self):
        from app.services.model_artifacts import dependency_available
        return enabled() and all(os.environ.get(name) for name in ("YOLO_WEIGHTS_PATH", "YOLO_WEIGHTS_SHA256", "YOLO_METADATA_PATH", "YOLO_METADATA_SHA256")) and all(Path(os.environ[name]).is_file() for name in ("YOLO_WEIGHTS_PATH", "YOLO_METADATA_PATH")) and all(dependency_available(name) for name in ("ultralytics", "PIL", "torch"))

    def _load(self):
        if self._model is not None:
            return
        if not self.configured:
            raise unavailable("RADIOLOGY_UNCONFIGURED")
        try:
            weights = Path(os.environ["YOLO_WEIGHTS_PATH"])
            if weights.suffix.lower() != ".pt":
                raise ValueError("Only explicitly trusted local YOLO artifacts supported")
            digest = pinned(weights, os.environ["YOLO_WEIGHTS_SHA256"])
            manifest, manifest_hash = metadata(Path(os.environ["YOLO_METADATA_PATH"]), os.environ["YOLO_METADATA_SHA256"])
            if manifest.get("task") != "fracture_detection" or not isinstance(manifest.get("labels"), dict) or not manifest["labels"]:
                raise ValueError("Task-specific class map required")
            labels = manifest["labels"]
            for index, label in labels.items():
                if not index.isdigit() or not isinstance(label, dict) or label.get("ontologyVerified") is not True:
                    raise ValueError("Verified class metadata required")
                for field in ("label", "className", "boneId", "ontologySourceReference"):
                    if not isinstance(label.get(field), str) or not label[field].strip():
                        raise ValueError("Class provenance required")
                valid_bone(label["boneId"])
                if not re.fullmatch(r"FMA:[0-9]+", label.get("fmaId", "")):
                    raise ValueError("Verified FMA mapping required")
            # .pt may execute pickle: only administrator-trusted, hash-pinned files may reach this call.
            os.environ["YOLO_AUTOINSTALL"] = "false"
            os.environ["ULTRALYTICS_OFFLINE"] = "true"
            os.environ.setdefault("YOLO_CONFIG_DIR", str(Path("data/model-runtime").resolve()))
            from ultralytics import YOLO
            model = YOLO(str(weights), task="detect")
            names = {str(key): value for key, value in model.names.items()}
            if getattr(model, "task", None) != "detect" or set(names) != set(labels) or any(names[key] != labels[key]["className"] for key in names):
                raise ValueError("Weights and class metadata differ")
            self._labels = labels
            self.provenance = {"task": "fracture_detection", "modelSha256": digest, "manifestSha256": manifest_hash}
            self._model = model
        except Exception:
            raise unavailable("RADIOLOGY_UNCONFIGURED") from None

    @staticmethod
    def _decode(content):
        try:
            from PIL import Image, ImageOps
        except ImportError:
            raise unavailable("RADIOLOGY_UNCONFIGURED") from None
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(content)) as probe:
                    width, height = probe.size
                    if probe.format != "PNG" or getattr(probe, "n_frames", 1) != 1 or min(width, height) < 1 or max(width, height) > 8192 or width * height > 16000000:
                        raise ValueError("Image limits exceeded")
                    probe.verify()
                with Image.open(io.BytesIO(content)) as decoded:
                    decoded.load()
                    image = ImageOps.exif_transpose(decoded).convert("RGB")
                    image.info.clear()
                    return image
        except Exception:
            raise HTTPException(422, "Invalid PNG or image decode/pixel/decompression limit exceeded") from None

    def predict(self, content: bytes):
        if len(content) > 10 * 1024 * 1024:
            raise HTTPException(413, "Image exceeds 10 MiB")
        with self._lock:
            self._load()
            image = self._decode(content)
            try:
                results = self._model.predict(source=image, device="cpu", conf=0.25, save=False, verbose=False)
                if len(results) != 1:
                    raise ValueError("Unexpected image result count")
                boxes = results[0].boxes
                if len(boxes) > 256:
                    raise ValueError("Detection limit exceeded")
                width, height = image.size
                findings = []
                for coordinates, confidence, class_value in zip(boxes.xyxy.tolist(), boxes.conf.tolist(), boxes.cls.tolist(), strict=True):
                    if not math.isfinite(class_value) or int(class_value) != class_value:
                        raise ValueError("Invalid class")
                    label = self._labels[str(int(class_value))]
                    xmin, ymin, xmax, ymax = coordinates
                    if not all(math.isfinite(value) for value in coordinates) or xmin > xmax or ymin > ymax:
                        raise ValueError("Invalid box")
                    normalized = [max(0.0, min(1.0, value)) for value in (ymin / height, xmin / width, ymax / height, xmax / width)]
                    findings.append(Finding(id=uuid4(), boneId=label["boneId"], fmaId=label["fmaId"], label=label["label"], confidence=confidence, boundingBox=normalized, displacementMm=None, aoOtaCode=None, radlexId=None).model_dump(mode="json"))
                return {"modelSha256": self.provenance["modelSha256"], "detections": findings}
            except HTTPException:
                raise
            except Exception:
                raise HTTPException(502, "Local radiology inference failed; no result accepted") from None
            finally:
                image.close()
