import json
from datetime import timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select

from app.core.audit_ledger import append_event, verify_ledger
from app.core.auth import Principal, authenticate, require_roles
from app.core.config import Role
from app.models.case_record import AuditEvent, CaseRecord, Signature, utc_now
from app.schemas import AmendRequest, CaseDTO, CreateCase, RevisionRequest, SessionDTO, UpdateCase

router = APIRouter(prefix="/api")
read_access = require_roles(Role.RADIOLOGIST, Role.RESEARCHER)
write_access = require_roles(Role.RADIOLOGIST)
compliance_access = require_roles(Role.COMPLIANCE_OFFICER)


def _utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _fields(record, cipher):
    def decrypt(column, field):
        return cipher.decrypt(column, record.id, field)
    return {
        "patientPseudoId": decrypt(record.patient_pseudo_id, "patientPseudoId"),
        "dicomSeriesInstanceUid": decrypt(record.dicom_uid, "dicomSeriesInstanceUid") if record.dicom_uid is not None else None,
        "reportText": decrypt(record.report_text, "reportText"),
        "modality": record.modality,
        "boneIds": json.loads(decrypt(record.bone_ids, "boneIds")),
        "findings": json.loads(decrypt(record.findings, "findings")),
    }


def _dto(record, cipher):
    return CaseDTO(**_fields(record, cipher), id=record.id, state=record.state, revision=record.revision,
                   signatures=[{"reviewerId": sig.reviewer_id, "revision": sig.revision, "signedAt": _utc(sig.signed_at)} for sig in sorted(record.signatures, key=lambda sig: sig.id)],
                   createdAt=_utc(record.created_at), updatedAt=_utc(record.updated_at))


def _set_fields(record, fields, cipher):
    for field, column in (("patientPseudoId", "patient_pseudo_id"), ("dicomSeriesInstanceUid", "dicom_uid"), ("reportText", "report_text"), ("boneIds", "bone_ids"), ("findings", "findings")):
        value = fields[field]
        if field in ("boneIds", "findings"):
            value = json.dumps(value, separators=(",", ":"))
        setattr(record, column, cipher.encrypt(value, record.id, field) if value is not None else None)
    record.modality = fields["modality"]


def _get(session, case_id):
    record = session.get(CaseRecord, str(case_id))
    if record is None:
        raise HTTPException(404, "Case not found")
    return record


def _check_revision(record, revision):
    if record.revision != revision:
        raise HTTPException(409, {"message": "Revision conflict; fetch current case", "currentRevision": record.revision})


def _audit(session, principal, action, record=None):
    append_event(session, principal.subject, principal.role.value, action, record.id if record else None, record.revision if record else None)


@router.get("/session", response_model=SessionDTO, response_model_exclude_defaults=True)
def session_info(principal: Principal = Depends(authenticate)):
    return SessionDTO(subject=principal.subject, role=principal.role, presentationMode=principal.is_presentation)


@router.post("/cases", response_model=CaseDTO, status_code=201)
def create_case(body: CreateCase, request: Request, principal: Principal = Depends(write_access)):
    with request.app.state.db.transaction() as session:
        record = CaseRecord(id=str(uuid4()), state="PRELIMINARY", revision=1)
        _set_fields(record, body.model_dump(mode="json"), request.app.state.cipher)
        session.add(record)
        session.flush()
        _audit(session, principal, "CREATE", record)
        result = _dto(record, request.app.state.cipher)
    return result


@router.get("/cases", response_model=list[CaseDTO])
def list_cases(request: Request, limit: int = Query(100, ge=1, le=100), offset: int = Query(0, ge=0), principal: Principal = Depends(read_access)):
    with request.app.state.db.transaction() as session:
        records = session.scalars(select(CaseRecord).order_by(CaseRecord.created_at.desc(), CaseRecord.id).offset(offset).limit(limit)).all()
        result = [_dto(record, request.app.state.cipher) for record in records]
        _audit(session, principal, "LIST")
    return result


@router.get("/cases/{case_id}", response_model=CaseDTO)
def get_case(case_id: UUID, request: Request, principal: Principal = Depends(read_access)):
    with request.app.state.db.transaction() as session:
        record = _get(session, case_id)
        result = _dto(record, request.app.state.cipher)
        _audit(session, principal, "ACCESS", record)
    return result


@router.get("/cases/{case_id}/export", response_model=CaseDTO)
def export_case(case_id: UUID, request: Request, principal: Principal = Depends(read_access)):
    with request.app.state.db.transaction() as session:
        record = _get(session, case_id)
        result = _dto(record, request.app.state.cipher)
        _audit(session, principal, "EXPORT", record)
    return result


@router.put("/cases/{case_id}", response_model=CaseDTO)
def update_case(case_id: UUID, body: UpdateCase, request: Request, principal: Principal = Depends(write_access)):
    cipher = request.app.state.cipher
    with request.app.state.db.transaction() as session:
        record = _get(session, case_id)
        _check_revision(record, body.expectedRevision)
        if record.state == "VERIFIED":
            raise HTTPException(409, "Verified cases require an explicit amendment before editing")
        fields = body.model_dump(mode="json", exclude={"expectedRevision"})
        if fields != _fields(record, cipher):
            _set_fields(record, fields, cipher)
            record.revision += 1
            record.signatures.clear()
            record.updated_at = utc_now()
            _audit(session, principal, "UPDATE", record)
        else:
            _audit(session, principal, "UPDATE_UNCHANGED", record)
        result = _dto(record, cipher)
    return result


@router.post("/cases/{case_id}/sign", response_model=CaseDTO)
def sign_case(case_id: UUID, body: RevisionRequest, request: Request, principal: Principal = Depends(write_access)):
    if principal.is_presentation:
        raise HTTPException(403, "Presentation sessions cannot sign reviews")
    with request.app.state.db.transaction() as session:
        record = _get(session, case_id)
        _check_revision(record, body.expectedRevision)
        if record.state == "VERIFIED":
            raise HTTPException(409, "Case is already verified")
        if not _fields(record, request.app.state.cipher)["findings"]:
            raise HTTPException(409, "At least one finding is required before signing")
        if any(sig.reviewer_id == principal.subject for sig in record.signatures):
            raise HTTPException(409, "A distinct second Radiologist is required")
        record.signatures.append(Signature(reviewer_id=principal.subject, revision=record.revision))
        if len(record.signatures) == 2:
            record.state = "VERIFIED"
        record.updated_at = utc_now()
        session.flush()
        _audit(session, principal, "VERIFY" if record.state == "VERIFIED" else "SIGN", record)
        result = _dto(record, request.app.state.cipher)
    return result


@router.post("/cases/{case_id}/amend", response_model=CaseDTO)
def amend_case(case_id: UUID, body: AmendRequest, request: Request, principal: Principal = Depends(write_access)):
    if principal.is_presentation:
        raise HTTPException(403, "Presentation sessions cannot amend reviews")
    with request.app.state.db.transaction() as session:
        record = _get(session, case_id)
        _check_revision(record, body.expectedRevision)
        if record.state != "VERIFIED":
            raise HTTPException(409, "Only a verified case can enter amendment")
        record.state = "AMENDED"
        record.revision += 1
        record.signatures.clear()
        record.amendment_reason = request.app.state.cipher.encrypt(body.reason, record.id, "amendmentReason")
        record.updated_at = utc_now()
        _audit(session, principal, "AMEND", record)
        result = _dto(record, request.app.state.cipher)
    return result


@router.get("/audit/verify")
def audit_verify(request: Request, principal: Principal = Depends(compliance_access)):
    with request.app.state.db.transaction() as session:
        result = verify_ledger(session)
        if result["valid"]:
            _audit(session, principal, "AUDIT_VERIFY")
    return result


@router.get("/audit/events")
def audit_events(request: Request, limit: int = Query(100, ge=1, le=100), offset: int = Query(0, ge=0), principal: Principal = Depends(compliance_access)):
    with request.app.state.db.transaction() as session:
        rows = session.scalars(select(AuditEvent).order_by(AuditEvent.sequence).offset(offset).limit(limit)).all()
        result = [{"sequence": row.sequence, "payload": json.loads(row.payload), "previousHash": row.previous_hash, "hash": row.digest} for row in rows]
        _audit(session, principal, "AUDIT_ACCESS")
    return result
