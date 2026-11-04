from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class CaseRecord(Base):
    __tablename__ = "case_records"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    patient_pseudo_id: Mapped[str] = mapped_column(Text)
    dicom_uid: Mapped[str | None] = mapped_column(Text, nullable=True)
    report_text: Mapped[str] = mapped_column(Text)
    bone_ids: Mapped[str] = mapped_column(Text)
    findings: Mapped[str] = mapped_column(Text)
    amendment_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    modality: Mapped[str] = mapped_column(String(2))
    state: Mapped[str] = mapped_column(String(16), default="PRELIMINARY")
    revision: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    signatures: Mapped[list["Signature"]] = relationship(cascade="all, delete-orphan", lazy="selectin")


class Signature(Base):
    __tablename__ = "signatures"
    __table_args__ = (UniqueConstraint("case_id", "revision", "reviewer_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    case_id: Mapped[str] = mapped_column(ForeignKey("case_records.id"))
    reviewer_id: Mapped[str] = mapped_column(String(128))
    revision: Mapped[int] = mapped_column(Integer)
    signed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class AuditEvent(Base):
    __tablename__ = "audit_events"
    sequence: Mapped[int] = mapped_column(Integer, primary_key=True)
    payload: Mapped[str] = mapped_column(Text)
    previous_hash: Mapped[str] = mapped_column(String(64))
    digest: Mapped[str] = mapped_column(String(64))


class AuditHead(Base):
    __tablename__ = "audit_head"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    sequence: Mapped[int] = mapped_column(Integer)
    digest: Mapped[str] = mapped_column(String(64))
