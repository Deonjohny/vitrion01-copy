"""Pinned single-class research detector. It does not identify bones, sides or 3D geometry."""
import ast
import hashlib
import importlib.util
import json
import threading
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException

from app.services.radiology_inference import RadiologyAdapter

MODEL_SHA256 = "5f16fff48dc54a5ca2b4c625a8df4d55c2beaef18b202fc8dba6e1117a112686"
MODEL_URL = "https://huggingface.co/Jesteban247/yolo11-fracture-onnx/resolve/8227dbcdcf80f3cd06f052a8295ee42657989deb/best.onnx"
MODEL_PATH = Path(__file__).resolve().parents[2] / "data" / "models" / "research-fracture" / "best.onnx"
WARNINGS = [
    "Experimental single-class detector; not clinically validated. Scores are not diagnostic probabilities.",
    "Bone identity and laterality are not inferred. Review and explicitly choose a catalog bone before 3D visualization.",
    "Detection boxes are not fracture-line segmentations or patient-specific 3D crack geometry.",
    "Montages, annotations and unsupported projections may produce missed or false detections. No detections do not exclude injury.",
    "Model graph declares AGPL-3.0; hosting card declares MIT. Resolve licensing obligations before redistribution or clinical/commercial deployment.",
]


def suppress_boxes(boxes, scores, threshold=0.45, maximum=64):
    """Deterministic class-agnostic NMS for the one documented fracture class."""
    import numpy as np
    order = np.argsort(-scores, kind="stable")
    selected = []
    while len(order) and len(selected) < maximum:
        index = int(order[0]); selected.append(index)
        others = order[1:]
        if not len(others): break
        upper_left = np.maximum(boxes[index, :2], boxes[others, :2])
        lower_right = np.minimum(boxes[index, 2:], boxes[others, 2:])
        intersection = np.maximum(lower_right - upper_left, 0).prod(axis=1)
        area = (boxes[index, 2] - boxes[index, 0]) * (boxes[index, 3] - boxes[index, 1])
        other_area = (boxes[others, 2] - boxes[others, 0]) * (boxes[others, 3] - boxes[others, 1])
        union = area + other_area - intersection
        overlap = np.divide(intersection, union, out=np.zeros_like(intersection), where=union > 0)
        order = others[overlap <= threshold]
    return selected


class ExperimentalFractureAdapter:
    def __init__(self):
        self._session = None
        self._lock = threading.Lock()
        self.provenance = {"task": "experimental_fracture_detection", "modelSha256": MODEL_SHA256, "manifestSha256": MODEL_SHA256}

    @property
    def configured(self):
        return MODEL_PATH.is_file() and all(importlib.util.find_spec(name) is not None for name in ("onnx", "onnxruntime", "numpy", "PIL"))

    def _load(self):
        if self._session is not None: return
        if not self.configured:
            raise HTTPException(503, "Research ONNX artifact/dependencies unavailable; no predictions fabricated")
        if MODEL_PATH.stat().st_size > 32 * 1024 * 1024 or hashlib.sha256(MODEL_PATH.read_bytes()).hexdigest() != MODEL_SHA256:
            raise HTTPException(503, "Research model checksum validation failed")
        import onnx
        import onnxruntime as ort
        model = onnx.load(str(MODEL_PATH), load_external_data=False)
        if len(model.graph.node) > 2000 or any(node.domain not in ("", "ai.onnx") for node in model.graph.node) or any(t.data_location == onnx.TensorProto.EXTERNAL for t in model.graph.initializer):
            raise HTTPException(503, "Unsupported model graph or external resources")
        meta = {item.key: item.value for item in model.metadata_props}
        if ast.literal_eval(meta.get("names", "{}")) != {0: "fracture"} or meta.get("task") != "detect":
            raise HTTPException(503, "Unexpected research model task/labels")
        options = ort.SessionOptions(); options.intra_op_num_threads = 2; options.inter_op_num_threads = 1
        session = ort.InferenceSession(str(MODEL_PATH), sess_options=options, providers=["CPUExecutionProvider"])
        if [(x.name, x.shape, x.type) for x in session.get_inputs()] != [("images", [1, 3, 640, 640], "tensor(float)")]:
            raise HTTPException(503, "Unexpected model input")
        self._session = session

    def predict(self, content):
        if not 0 < len(content) <= 10 * 1024 * 1024:
            raise HTTPException(413, "Radiograph must be nonempty and at most 10 MiB")
        image = RadiologyAdapter._decode(content)
        try:
            with self._lock:
                self._load()
                import numpy as np
                from PIL import Image
                width, height = image.size
                scale = min(640 / width, 640 / height)
                scaled = (round(width * scale), round(height * scale))
                left = (640 - scaled[0]) // 2; top = (640 - scaled[1]) // 2
                padded = Image.new("RGB", (640, 640), (114, 114, 114))
                resized = image.resize(scaled, Image.Resampling.BILINEAR)
                padded.paste(resized, (left, top)); resized.close()
                tensor = np.asarray(padded, dtype=np.float32).transpose(2, 0, 1)[None] / 255.0
                padded.close()
                raw = self._session.run(None, {"images": tensor})[0]
                if raw.shape != (1, 5, 8400) or not np.isfinite(raw).all():
                    raise HTTPException(502, "Invalid model output shape or values")
                candidates = raw[0].T
                candidates = candidates[(candidates[:, 4] >= 0.25) & (candidates[:, 4] <= 1)]
                if len(candidates) > 4096:
                    candidates = candidates[np.argsort(-candidates[:, 4], kind="stable")[:4096]]
                boxes = np.empty((len(candidates), 4), dtype=np.float32)
                boxes[:, 0] = (candidates[:, 0] - candidates[:, 2] / 2 - left) / scale
                boxes[:, 1] = (candidates[:, 1] - candidates[:, 3] / 2 - top) / scale
                boxes[:, 2] = (candidates[:, 0] + candidates[:, 2] / 2 - left) / scale
                boxes[:, 3] = (candidates[:, 1] + candidates[:, 3] / 2 - top) / scale
                boxes[:, [0, 2]] = boxes[:, [0, 2]].clip(0, width)
                boxes[:, [1, 3]] = boxes[:, [1, 3]].clip(0, height)
                valid = (boxes[:, 2] > boxes[:, 0]) & (boxes[:, 3] > boxes[:, 1])
                boxes = boxes[valid]; scores = candidates[valid, 4]
                detections = []
                for index in suppress_boxes(boxes, scores):
                    xmin, ymin, xmax, ymax = boxes[index].tolist()
                    detections.append({"id": str(uuid4()), "boneId": None, "fmaId": None, "label": "Experimental suspected fracture region — reviewer confirmation required", "confidence": float(scores[index]), "boundingBox": [ymin / height, xmin / width, ymax / height, xmax / width], "displacementMm": None, "aoOtaCode": None, "radlexId": None})
                return {"modelSha256": MODEL_SHA256, "detections": detections, "method": "experimental-onnx-fracture-detector", "clinicallyValidated": False, "sourceSha256": hashlib.sha256(content).hexdigest(), "imageWidth": width, "imageHeight": height, "warnings": WARNINGS}
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(502, "Experimental inference failed; no model output accepted") from None
        finally:
            image.close()
