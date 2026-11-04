"""Packaged copy of the frontend catalog's canonical IDs; never infer IDs."""
import json
from pathlib import Path

REGISTRY_PATH = Path(__file__).resolve().parents[1] / "data" / "bone-ids.json"


def bone_ids() -> frozenset[str]:
    value = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    ids = value if isinstance(value, list) else value["boneIds"]
    return frozenset(ids)


def valid_bone(value: str) -> str:
    if value not in bone_ids():
        raise ValueError("Unknown boneId; use the shared anatomical catalog")
    return value
