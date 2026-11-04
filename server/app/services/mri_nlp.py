"""Local task-fine-tuned safetensors token classification; text only, never MRI pixels."""
import json
import math
import os
import threading
from pathlib import Path

from fastapi import HTTPException

from app.services.model_artifacts import enabled, metadata, pinned, unavailable

ENTITY_TYPES = {"ANATOMY": "anatomy", "RADLEX": "radlex", "LESION_GRADE": "lesionGrade", "ALERT": "alert"}
EXPECTED_LABELS = {"O"} | {f"{prefix}-{name}" for name in ENTITY_TYPES for prefix in ("B", "I")}


class MRIAdapter:
    def __init__(self):
        self._lock = threading.Lock()
        self._pipeline = None
        self._tokenizer = None
        self._max_tokens = 512
        self.provenance = None

    @property
    def configured(self):
        from app.services.model_artifacts import dependency_available
        directory = Path(os.environ.get("MRI_MODEL_DIR", ""))
        return enabled() and bool(os.environ.get("MRI_MODEL_DIR")) and bool(os.environ.get("MRI_MANIFEST_SHA256")) and (directory / "model_manifest.json").is_file() and (directory / "config.json").is_file() and any(directory.glob("*.safetensors")) and all(dependency_available(name) for name in ("transformers", "torch", "safetensors"))

    def _load(self):
        if self._pipeline is not None:
            return
        if not self.configured:
            raise unavailable("MRI_NLP_UNCONFIGURED")
        try:
            directory = Path(os.environ["MRI_MODEL_DIR"])
            if not directory.is_absolute() or directory.is_symlink() or not directory.is_dir():
                raise ValueError("Local model directory required")
            manifest, digest = metadata(directory / "model_manifest.json", os.environ["MRI_MANIFEST_SHA256"])
            if manifest.get("task") != "mri_token_classification" or manifest.get("entityTypes") != ENTITY_TYPES:
                raise ValueError("Explicit MRI NER schema required")
            files = manifest.get("files")
            if not isinstance(files, dict) or "config.json" not in files or not any(name.endswith(".safetensors") for name in files):
                raise ValueError("Safetensors and pinned config required")
            actual = {str(path.relative_to(directory)).replace(chr(92), "/") for path in directory.rglob("*") if path.is_file() and path.name != "model_manifest.json"}
            if set(files) != actual or any(path.is_symlink() for path in directory.rglob("*")):
                raise ValueError("Unpinned or symlinked artifact")
            for name, checksum in files.items():
                relative = Path(name)
                if relative.is_absolute() or ".." in relative.parts or relative.suffix.lower() in (".bin", ".pt", ".pth", ".py", ".pkl"):
                    raise ValueError("Unsafe model artifact")
                pinned(directory / relative, checksum)
            for name in files:
                if name.endswith(".safetensors.index.json"):
                    index = json.loads((directory / name).read_text(encoding="utf-8"))
                    shards = index.get("weight_map", {})
                    if not shards or any(shard not in files or not shard.endswith(".safetensors") for shard in shards.values()):
                        raise ValueError("Unpinned safetensors shard reference")
            config = json.loads((directory / "config.json").read_text(encoding="utf-8"))
            labels = config.get("id2label", {})
            if set(labels.values()) != EXPECTED_LABELS or len(labels) != len(EXPECTED_LABELS) or not any(name.endswith("ForTokenClassification") for name in config.get("architectures", [])):
                raise ValueError("Base language model or generic classifier labels rejected")
            os.environ["HF_HUB_OFFLINE"] = "1"
            os.environ["TRANSFORMERS_OFFLINE"] = "1"
            os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
            from transformers import AutoModelForTokenClassification, AutoTokenizer, pipeline
            tokenizer = AutoTokenizer.from_pretrained(str(directory), local_files_only=True, trust_remote_code=False, use_fast=True)
            model = AutoModelForTokenClassification.from_pretrained(str(directory), local_files_only=True, trust_remote_code=False, use_safetensors=True)
            if set(model.config.id2label.values()) != EXPECTED_LABELS or not tokenizer.is_fast:
                raise ValueError("Loaded model label schema differs")
            self._max_tokens = min(512, int(getattr(model.config, "max_position_embeddings", 512)), int(tokenizer.model_max_length))
            self._tokenizer = tokenizer
            self._pipeline = pipeline("token-classification", model=model, tokenizer=tokenizer, aggregation_strategy="simple", device=-1)
            self.provenance = {"task": "mri_token_classification", "modelSha256": digest, "manifestSha256": digest}
        except Exception:
            raise unavailable("MRI_NLP_UNCONFIGURED") from None

    def extract(self, text: str):
        with self._lock:
            self._load()
            try:
                tokens = self._tokenizer(text, add_special_tokens=True, truncation=False)["input_ids"]
                if len(tokens) > self._max_tokens:
                    raise HTTPException(413, "MRI text exceeds the local model token window; split the report explicitly")
                output = self._pipeline(text)
                if len(output) > 256:
                    raise ValueError("Entity limit exceeded")
                entities = []
                for entity in output:
                    group = entity["entity_group"]
                    start, end = int(entity["start"]), int(entity["end"])
                    score = float(entity["score"])
                    if group not in ENTITY_TYPES or not 0 <= start < end <= len(text) or not math.isfinite(score) or not 0 <= score <= 1:
                        raise ValueError("Invalid model entity")
                    entities.append({"label": group, "text": text[start:end], "start": start, "end": end, "score": score, "boneId": None, "radlexId": None})
                return {"modelSha256": self.provenance["modelSha256"], "entities": entities}
            except HTTPException:
                raise
            except Exception:
                raise HTTPException(502, "Local MRI token classification failed; no result accepted") from None
