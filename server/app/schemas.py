from datetime import datetime
from enum import Enum
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator, model_validator

from app.core.config import Role
from app.services.bone_registry import valid_bone


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class SessionDTO(StrictModel):
    subject: str
    role: Role
    presentationMode: bool = False


class WorkflowState(str, Enum):
    PRELIMINARY = "PRELIMINARY"
    VERIFIED = "VERIFIED"
    AMENDED = "AMENDED"


class ReportEvidence(StrictModel):
    page: int = Field(ge=1, le=10)
    section: str
    text: str
    start: int = Field(ge=0)
    end: int = Field(ge=0)


class ReportProvenance(StrictModel):
    sourceSha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    method: Literal["rule-based-report-extraction"]
    assertion: Literal["present", "absent", "uncertain"]
    temporality: Literal["acute", "chronic", "unspecified"]
    evidence: ReportEvidence
    laterality: Literal["Left", "Right", "Midline", "Unspecified"]


class ImageProvenance(StrictModel):
    sourceSha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    modelSha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    method: Literal["experimental-onnx-fracture-detector"]
    imageWidth: StrictInt = Field(gt=0)
    imageHeight: StrictInt = Field(gt=0)
    reviewerAssignedAnatomy: Literal[True]


class ManualImageProvenance(StrictModel):
    sourceSha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    method: Literal["reviewer-drawn-fracture-trace"]
    imageWidth: StrictInt = Field(gt=0)
    imageHeight: StrictInt = Field(gt=0)
    points: list[tuple[Annotated[float, Field(ge=0, le=1)], Annotated[float, Field(ge=0, le=1)]]] = Field(min_length=2, max_length=64)
    reviewerAssignedAnatomy: Literal[True]

    @field_validator("points")
    @classmethod
    def nonzero_trace(cls, value):
        if len(set(value)) < 2:
            raise ValueError("A manual trace must include at least two distinct points")
        return value


class Finding(StrictModel):
    manualImageEvidence: ManualImageProvenance | None = None
    imageEvidence: ImageProvenance | None = None
    reportEvidence: ReportProvenance | None = None
    id: UUID
    boneId: str | None = Field(default=None, max_length=128)
    fmaId: str | None = Field(default=None, max_length=128)
    label: str = Field(min_length=1, max_length=500)
    confidence: float | None = Field(default=None, ge=0, le=1)
    boundingBox: tuple[float, float, float, float] | None = None
    displacementMm: float | None = Field(default=None, ge=0)
    aoOtaCode: str | None = Field(default=None, max_length=128)
    radlexId: str | None = Field(default=None, max_length=128)

    @field_validator("boneId")
    @classmethod
    def catalog_bone(cls, value):
        return valid_bone(value) if value is not None else None

    @model_validator(mode="after")
    def ordered_box(self):
        if self.boundingBox:
            ymin, xmin, ymax, xmax = self.boundingBox
            if min(self.boundingBox) < 0 or max(self.boundingBox) > 1 or ymin >= ymax or xmin >= xmax:
                raise ValueError("boundingBox must be normalized [ymin,xmin,ymax,xmax] in [0,1] with positive area")
        return self


class CaseFields(StrictModel):
    patientPseudoId: str = Field(min_length=1, max_length=256)
    dicomSeriesInstanceUid: str | None = Field(default=None, max_length=64)
    reportText: str = Field(default="", max_length=100000)
    modality: Literal["XR", "MR", "CT", "OT"]
    boneIds: list[Annotated[str, Field(min_length=1, max_length=128)]] = Field(default_factory=list, max_length=256)
    findings: list[Finding] = Field(default_factory=list, max_length=256)

    @field_validator("boneIds")
    @classmethod
    def catalog_bones(cls, values):
        return [valid_bone(value) for value in values]

    @field_validator("findings")
    @classmethod
    def unique_findings(cls, findings):
        if len({finding.id for finding in findings}) != len(findings):
            raise ValueError("Finding IDs must be unique within a case")
        return findings


class CreateCase(CaseFields):
    pass


class UpdateCase(CaseFields):
    expectedRevision: StrictInt = Field(ge=1)


class RevisionRequest(StrictModel):
    expectedRevision: StrictInt = Field(ge=1)


class AmendRequest(RevisionRequest):
    reason: str = Field(min_length=1, max_length=2000)

    @field_validator("reason")
    @classmethod
    def meaningful_reason(cls, value):
        if not value.strip():
            raise ValueError("Amendment reason is required")
        return value


class SignatureDTO(StrictModel):
    reviewerId: str
    revision: int
    signedAt: datetime


class CaseDTO(CaseFields):
    id: UUID
    state: WorkflowState
    revision: int
    signatures: list[SignatureDTO]
    createdAt: datetime
    updatedAt: datetime


class MRIRequest(StrictModel):
    reportText: str = Field(min_length=1, max_length=20000)
    caseId: UUID | None = None


class RadiologyResult(StrictModel):
    modelSha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    detections: list[Finding]


class MRIEntity(StrictModel):
    text: str
    start: int = Field(ge=0)
    end: int = Field(ge=0)
    label: Literal["ANATOMY", "RADLEX", "LESION_GRADE", "ALERT"]
    score: float = Field(ge=0, le=1)
    radlexId: str | None = None
    boneId: str | None = None


class MRIResult(StrictModel):
    modelSha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    entities: list[MRIEntity]


class ReportPage(StrictModel):
    page: int = Field(ge=1, le=10)
    text: str
    extraction: Literal["digital", "ocr"]




class ReportFinding(StrictModel):
    id: UUID
    boneId: str | None
    label: str
    evidence: ReportEvidence
    assertion: Literal["present", "absent", "uncertain"]
    temporality: Literal["acute", "chronic", "unspecified"]
    laterality: Literal["Left", "Right", "Midline", "Unspecified"]
    reviewRequired: Literal[True] = True

    @field_validator("boneId")
    @classmethod
    def catalog_bone(cls, value):
        return valid_bone(value) if value is not None else None


class ReportResult(StrictModel):
    method: Literal["rule-based-report-extraction"]
    clinicallyValidated: Literal[False] = False
    sourceSha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    pages: list[ReportPage]
    findings: list[ReportFinding]
    warnings: list[str]
