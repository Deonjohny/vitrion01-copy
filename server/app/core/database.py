from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import create_engine, event, select, text
from sqlalchemy.orm import Session

from app.models.case_record import AuditHead, Base

GENESIS = "0" * 64


class Database:
    def __init__(self, url: str):
        sqlite = url.startswith("sqlite:")
        if sqlite and url != "sqlite:///:memory:":
            Path(url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
        self.engine = create_engine(url, connect_args={"check_same_thread": False, "timeout": 30} if sqlite else {}, pool_pre_ping=True)
        if sqlite:
            @event.listens_for(self.engine, "connect")
            def configure_sqlite(connection, _):
                connection.execute("PRAGMA foreign_keys=ON")
        self.sqlite = sqlite

    def initialize(self):
        Base.metadata.create_all(self.engine)
        with self.engine.begin() as conn:
            if self.sqlite:
                conn.execute(text("INSERT OR IGNORE INTO audit_head (id, sequence, digest) VALUES (1, 0, :digest)"), {"digest": GENESIS})
                for action in ("UPDATE", "DELETE"):
                    conn.exec_driver_sql(f"CREATE TRIGGER IF NOT EXISTS audit_no_{action.lower()} BEFORE {action} ON audit_events BEGIN SELECT RAISE(ABORT, 'audit events are append-only'); END")
            else:
                conn.execute(text("INSERT INTO audit_head (id, sequence, digest) VALUES (1, 0, :digest) ON CONFLICT (id) DO NOTHING"), {"digest": GENESIS})
                conn.exec_driver_sql("CREATE OR REPLACE FUNCTION deny_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit events are append-only'; END; $$")
                conn.exec_driver_sql("DROP TRIGGER IF EXISTS audit_immutable ON audit_events")
                conn.exec_driver_sql("CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION deny_audit_mutation()")
                conn.exec_driver_sql("DROP TRIGGER IF EXISTS audit_no_truncate ON audit_events")
                conn.exec_driver_sql("CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON audit_events FOR EACH STATEMENT EXECUTE FUNCTION deny_audit_mutation()")

    @contextmanager
    def transaction(self):
        with Session(self.engine, expire_on_commit=False) as session:
            try:
                if self.sqlite:
                    session.connection().exec_driver_sql("BEGIN IMMEDIATE")
                head = session.scalar(select(AuditHead).where(AuditHead.id == 1).with_for_update())
                if head is None:
                    raise RuntimeError("Audit head missing")
                yield session
                session.commit()
            except Exception:
                session.rollback()
                raise
