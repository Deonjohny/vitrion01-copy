"""Loopback-only launcher loading the operator-owned, ignored server/.env file."""
import argparse
import os
from pathlib import Path

import uvicorn

ALLOWED_SETTINGS = {
    "LOCAL_NO_PHI_MODE", "PRESENTATION_MODE", "DATABASE_URL", "PHI_ENCRYPTION_KEY", "JWT_SECRET",
    "JWT_ISSUER", "JWT_AUDIENCE", "LOCAL_USERS_JSON", "DEV_CORS",
    "LOCAL_MODELS_ENABLED", "YOLO_WEIGHTS_PATH", "YOLO_WEIGHTS_SHA256", "YOLO_METADATA_PATH",
    "YOLO_METADATA_SHA256", "MRI_MODEL_DIR", "MRI_MANIFEST_SHA256",
}


def load_local_env(path: Path):
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        name, separator, value = line.partition("=")
        if not separator or name not in ALLOWED_SETTINGS:
            raise ValueError("Invalid local environment setting")
        os.environ.setdefault(name, value)


def port_number(value):
    try:
        port = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError("port must be an integer from 1024 to 65535") from None
    if not 1024 <= port <= 65535:
        raise argparse.ArgumentTypeError("port must be an integer from 1024 to 65535")
    return port


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=port_number, default=8000, help="Loopback port (1024–65535; default 8000)")
    args = parser.parse_args(argv)
    server = Path(__file__).resolve().parent.parent
    os.chdir(server)
    load_local_env(server / ".env")
    uvicorn.run("app.main:app", host="127.0.0.1", port=args.port, access_log=False)


if __name__ == "__main__":
    main()
