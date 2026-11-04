"""Hash-linked metadata ledger. All callers hold the database audit-head lock."""
import hashlib
import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import GENESIS
from app.models.case_record import AuditEvent, AuditHead, utc_now


def canonical(value: dict) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def event_digest(sequence: int, previous: str, payload: str) -> str:
    return hashlib.sha256(canonical({"sequence": sequence, "previousHash": previous, "payload": payload}).encode()).hexdigest()


def append_event(session: Session, actor: str, role: str, action: str, case_id: str | None = None, revision: int | None = None, model_info: dict | None = None, report_info: dict | None = None):
    head = session.get(AuditHead, 1)
    if head is None:
        raise RuntimeError("Audit head missing")
    sequence = head.sequence + 1
    event = {"actor": actor, "role": role, "action": action, "caseId": case_id, "revision": revision, "occurredAt": utc_now().isoformat()}
    if model_info is not None:
        if set(model_info) != {"task", "modelSha256", "manifestSha256"}:
            raise ValueError("Unexpected model audit metadata")
        event["model"] = dict(model_info)
    if report_info is not None:
        if action != "REPORT_EXTRACT" or set(report_info) != {"method", "codeSha256", "sourceSha256"}:
            raise ValueError("Unexpected report audit metadata")
        import re
        if report_info["method"] != "rule-based-report-extraction" or any(not re.fullmatch(r"[a-f0-9]{64}", report_info[key]) for key in ("codeSha256", "sourceSha256")):
            raise ValueError("Invalid report provenance")
        event["report"] = dict(report_info)
    payload = canonical(event)
    digest = event_digest(sequence, head.digest, payload)
    session.add(AuditEvent(sequence=sequence, payload=payload, previous_hash=head.digest, digest=digest))
    head.sequence = sequence
    head.digest = digest
    session.flush()


def verify_ledger(session: Session) -> dict:
    head = session.get(AuditHead, 1)
    previous, count = GENESIS, 0
    for row in session.scalars(select(AuditEvent).order_by(AuditEvent.sequence)).yield_per(100):
        count += 1
        if row.sequence != count or row.previous_hash != previous or row.digest != event_digest(row.sequence, row.previous_hash, row.payload):
            return {"valid": False, "entries": count, "checkedEvents": count, "firstInvalidSequence": row.sequence}
        previous = row.digest
    valid = head is not None and head.sequence == count and head.digest == previous
    return {"valid": valid, "entries": count, "checkedEvents": count, "firstInvalidSequence": None if valid else count + 1}
