"""Strict local artifact pins. Administrator assertions are not clinical certification."""
import hashlib
import json
import os
import re
from pathlib import Path

from fastapi import HTTPException


def unavailable(code):
    return HTTPException(503, {"code": code, "message": "Local task-trained model is disabled, missing, or failed artifact/schema validation. No clinical validity is claimed."})


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def pinned(path, checksum, max_bytes=2147483648):
    if not re.fullmatch(r"[a-fA-F0-9]{64}", checksum or ""):
        raise ValueError("Missing SHA256 pin")
    if not path.is_absolute() or path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= max_bytes:
        raise ValueError("Invalid local artifact")
    digest = sha256_file(path)
    if digest != checksum.lower():
        raise ValueError("Artifact checksum mismatch")
    return digest


def metadata(path, checksum):
    digest = pinned(path, checksum, 65536)
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or data.get("taskTrained") is not True:
        raise ValueError("Task training attestation required")
    for field in ("modelName", "trainingReference", "validationReference"):
        if not isinstance(data.get(field), str) or not data[field].strip():
            raise ValueError("Model provenance required")
    return data, digest


def enabled():
    return os.environ.get("LOCAL_MODELS_ENABLED") == "true"


def dependency_available(name):
    import importlib.util
    import sys
    if name in sys.modules:
        return sys.modules[name] is not None
    try:
        return importlib.util.find_spec(name) is not None
    except (ValueError, ImportError):
        return False
