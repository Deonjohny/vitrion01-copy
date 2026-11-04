import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DatabaseError

from app.models.case_record import AuditEvent
from conftest import authorization


def test_append_only_triggers_and_detected_edit(local_service, synthetic_case):
    client, app, config = local_service
    client.post("/api/cases", headers=authorization(config), json=synthetic_case)
    for statement in ("UPDATE audit_events SET payload='tampered' WHERE sequence=1", "DELETE FROM audit_events WHERE sequence=1"):
        with pytest.raises(DatabaseError):
            with app.state.db.engine.begin() as conn:
                conn.execute(text(statement))
    assert client.get("/api/audit/verify", headers=authorization(config, "compliance")).json()["valid"]
    # Simulate a privileged database attacker bypassing the application's append-only trigger.
    with app.state.db.engine.begin() as conn:
        conn.execute(text("DROP TRIGGER audit_no_update"))
        conn.execute(text("UPDATE audit_events SET payload='tampered' WHERE sequence=1"))
    result = client.get("/api/audit/verify", headers=authorization(config, "compliance")).json()
    assert result["valid"] is False and result["firstInvalidSequence"] == 1


def test_trailing_deletion_and_transaction_rollback(local_service, synthetic_case):
    client, app, config = local_service
    client.post("/api/cases", headers=authorization(config), json=synthetic_case)
    client.get("/api/cases", headers=authorization(config))
    with app.state.db.transaction() as session:
        before = len(session.scalars(select(AuditEvent)).all())
    with pytest.raises(RuntimeError):
        with app.state.db.transaction() as session:
            from app.core.audit_ledger import append_event
            append_event(session, "rad-one", "Radiologist", "ROLLBACK_TEST")
            raise RuntimeError("Simulated transaction failure")
    with app.state.db.transaction() as session:
        assert len(session.scalars(select(AuditEvent)).all()) == before
    with app.state.db.engine.begin() as conn:
        conn.execute(text("DROP TRIGGER audit_no_delete"))
        conn.execute(text("DELETE FROM audit_events WHERE sequence = (SELECT MAX(sequence) FROM audit_events)"))
    assert client.get("/api/audit/verify", headers=authorization(config, "compliance")).json()["valid"] is False


def test_persistence_across_app_restart(local_service, synthetic_case):
    from fastapi.testclient import TestClient
    from app.main import create_app
    client, _, config = local_service
    created = client.post("/api/cases", headers=authorization(config), json=synthetic_case).json()
    with TestClient(create_app(config)) as restarted:
        assert restarted.get("/api/cases/" + created["id"], headers=authorization(config)).json() == created
        assert restarted.get("/api/audit/verify", headers=authorization(config, "compliance")).json()["valid"]
