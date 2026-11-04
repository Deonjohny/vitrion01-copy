import shutil
from pathlib import Path
from uuid import uuid4

import jwt
import pytest
from fastapi.testclient import TestClient

from app.core.config import Role, Settings
from app.main import create_app


@pytest.fixture
def local_service():
    directory = Path(__file__).parent / "_runtime" / str(uuid4())
    directory.mkdir(parents=True)
    config = Settings(database_url="sqlite:///" + str(directory / "cases.db"), encryption_key=b"e" * 32,
                      jwt_secret="test-signing-only-" + "s" * 48, jwt_issuer="test-local", jwt_audience="synthetic-client",
                      users={"rad-one": Role.RADIOLOGIST, "rad-two": Role.RADIOLOGIST,
                             "research": Role.RESEARCHER, "compliance": Role.COMPLIANCE_OFFICER})
    app = create_app(config)
    try:
        with TestClient(app) as client:
            yield client, app, config
    finally:
        shutil.rmtree(directory)
        if directory.parent.exists() and not any(directory.parent.iterdir()):
            directory.parent.rmdir()


def authorization(config, subject="rad-one", **overrides):
    from datetime import datetime, timezone
    now = int(datetime.now(timezone.utc).timestamp())
    claims = {"sub": subject, "iss": config.jwt_issuer, "aud": config.jwt_audience, "iat": now, "nbf": now, "exp": now + 600}
    claims.update(overrides)
    return {"Authorization": "Bearer " + jwt.encode(claims, config.jwt_secret, algorithm="HS256")}


@pytest.fixture
def synthetic_png():
    import io
    from PIL import Image
    with Image.new("RGB", (16, 16), (40, 40, 40)) as image:
        stream = io.BytesIO()
        image.save(stream, format="PNG")
        return stream.getvalue()


@pytest.fixture
def synthetic_case():
    return {"patientPseudoId": "synthetic-only-001", "dicomSeriesInstanceUid": "2.25.123456789", "reportText": "Synthetic demonstration only.",
            "modality": "XR", "boneIds": ["C6"], "findings": [{"id": str(uuid4()), "boneId": "C6", "fmaId": None,
            "label": "Synthetic manually entered finding", "confidence": None, "boundingBox": [0.1, 0.2, 0.3, 0.4], "displacementMm": None,
            "aoOtaCode": None, "radlexId": None}]}
