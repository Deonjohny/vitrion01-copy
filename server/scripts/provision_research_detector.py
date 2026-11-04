"""Explicitly provision one pinned public ONNX research artifact, never pickle weights."""
import argparse
import hashlib
import json
import time
import urllib.request
from pathlib import Path

from app.services.experimental_fracture import MODEL_PATH, MODEL_SHA256, MODEL_URL

MAX_BYTES = 32 * 1024 * 1024
REVISION = "8227dbcdcf80f3cd06f052a8295ee42657989deb"
CARD_URL = f"https://huggingface.co/Jesteban247/yolo11-fracture-onnx/blob/{REVISION}/README.md"
LICENSE_WARNING = (
    "LICENSING CONFLICT: hosting card declares MIT, but the pinned ONNX graph declares "
    "AGPL-3.0 License (https://ultralytics.com/license). Do not assume MIT covers the "
    "weights or upstream training software. Resolve applicable license obligations "
    "before redistribution, deployment or commercial use. Downloaded runtime artifact "
    "is not bundled source code and is not a clinically validated medical device."
)


def verify(path):
    if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= MAX_BYTES:
        raise ValueError("Expected a regular, nonempty ONNX artifact no larger than 32 MiB")
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    if digest.hexdigest() != MODEL_SHA256:
        raise ValueError("Pinned model SHA-256 mismatch; existing file was not modified")
    return path.stat().st_size


def download(destination):
    if destination.exists():
        return verify(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = destination.with_name(destination.name + ".download")
    # Exclusive creation avoids replacing another operator's download/staging file.
    created = False
    try:
        with staging.open("xb") as target:
            created = True
            request = urllib.request.Request(MODEL_URL, headers={"User-Agent": "local-orthopedic-research-provisioner/1"})
            deadline = time.monotonic() + 180
            with urllib.request.urlopen(request, timeout=30) as response:
                if not response.geturl().startswith("https://"):
                    raise ValueError("Non-HTTPS artifact redirect refused")
                declared = response.headers.get("Content-Length")
                if declared is not None and int(declared) > MAX_BYTES:
                    raise ValueError("Artifact exceeds 32 MiB")
                size = 0
                while True:
                    if time.monotonic() > deadline:
                        raise TimeoutError("Artifact download time budget exceeded")
                    block = response.read(1024 * 1024)
                    if not block:
                        break
                    size += len(block)
                    if size > MAX_BYTES:
                        raise ValueError("Artifact exceeds 32 MiB")
                    target.write(block)
        size = verify(staging)
        if destination.exists():
            raise FileExistsError("Destination appeared during download; refusing replacement")
        staging.rename(destination)
        return size
    finally:
        if created and staging.exists():
            staging.unlink()


def write_provenance(directory, size):
    provenance = {
        "modelUrl": MODEL_URL, "hostingCardUrl": CARD_URL, "revision": REVISION,
        "sha256": MODEL_SHA256, "bytes": size, "format": "ONNX",
        "hostingCardDeclaredLicense": "MIT", "embeddedGraphDeclaredLicense": "AGPL-3.0",
        "licenseReferences": ["https://opensource.org/license/mit", "https://www.gnu.org/licenses/agpl-3.0.html", "https://ultralytics.com/license"],
        "licenseWarning": LICENSE_WARNING,
        "clinicallyValidated": False, "classes": {"0": "fracture"},
        "limitations": ["Research-only runtime artifact", "No bone identity, laterality, measurements or fracture-line/3D geometry", "No detections do not exclude injury", "Administrator must resolve license conflict before redistribution/deployment"],
    }
    (directory / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")
    (directory / "LICENSE-WARNING.txt").write_text(LICENSE_WARNING + "\n\nLicense references:\nhttps://www.gnu.org/licenses/agpl-3.0.html\nhttps://opensource.org/license/mit\nhttps://ultralytics.com/license\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify-only", action="store_true", help="Verify existing pinned artifact without network access")
    args = parser.parse_args()
    size = verify(MODEL_PATH) if args.verify_only else download(MODEL_PATH)
    write_provenance(MODEL_PATH.parent, size)
    print(f"Verified research ONNX: {size} bytes; SHA-256 {MODEL_SHA256}")
    print(LICENSE_WARNING)


if __name__ == "__main__":
    main()
