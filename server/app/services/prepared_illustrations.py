"""Exact-byte lookup of ten curated, approximate presentation illustrations.

This is not image inference or reconstruction. Coordinates are preauthored
fractions of the displayed bone's bounding box, not measurements from a PNG.
The catalog contains hashes and presentation metadata only; never source images.
"""
import hashlib
import json
from functools import lru_cache
from pathlib import Path
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.services.bone_registry import valid_bone

CATALOG_PATH = Path(__file__).resolve().parents[1] / "data" / "prepared-illustrations.json"
METHOD = "prepared-image-illustration"
LABEL = "Prepared illustration—not AI reconstruction"
UNMATCHED_MESSAGE = "No prepared illustration for this exact PNG. No result was fabricated."


class PreparedFracture(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    positionFraction: tuple[
        Annotated[float, Field(ge=0, le=1)],
        Annotated[float, Field(ge=0, le=1)],
        Annotated[float, Field(ge=0, le=1)],
    ]
    angleDegrees: float
    size: float = Field(ge=0.1, le=0.6)


class PreparedIllustration(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    sourceSha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    title: str = Field(min_length=1)
    boneIds: list[str] = Field(min_length=1)
    targetBoneId: str | None = None
    fracture: PreparedFracture
    limitations: list[str] = Field(min_length=1)

    @model_validator(mode="before")
    @classmethod
    def default_target(cls, value):
        if isinstance(value, dict) and "targetBoneId" not in value and value.get("boneIds"):
            return {**value, "targetBoneId": value["boneIds"][0]}
        return value

    @field_validator("boneIds")
    @classmethod
    def canonical_bones(cls, values):
        if len(values) != len(set(values)):
            raise ValueError("Duplicate bone IDs")
        return [valid_bone(value) for value in values]

    @model_validator(mode="after")
    def target_in_region(self):
        if self.targetBoneId is not None and self.targetBoneId not in self.boneIds:
            raise ValueError("Target must belong to the illustrative region")
        return self


@lru_cache(maxsize=1)
def catalog() -> tuple[PreparedIllustration, ...]:
    entries = tuple(PreparedIllustration.model_validate(value) for value in json.loads(CATALOG_PATH.read_text(encoding="utf-8")))
    if len(entries) != 10 or len({entry.sourceSha256 for entry in entries}) != 10:
        raise ValueError("Expected exactly ten distinct prepared PNG hashes")
    return entries


def lookup(content: bytes) -> dict:
    """Match original bytes only; no filename, path, pixel or perceptual fallback."""
    digest = hashlib.sha256(content).hexdigest()
    envelope = {"method": METHOD, "clinicallyValidated": False, "sourceSha256": digest}
    for entry in catalog():
        if entry.sourceSha256 == digest:
            return {**entry.model_dump(mode="json"), **envelope, "matched": True, "label": LABEL}
    return {**envelope, "matched": False, "message": UNMATCHED_MESSAGE}
