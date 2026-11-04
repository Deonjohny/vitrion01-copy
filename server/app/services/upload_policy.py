"""Shared input contract: actual PNG X-rays and written-report PDFs only."""
from fastapi import HTTPException, UploadFile

MAX_FILE_BYTES = 10 * 1024 * 1024
POLICIES = {
    "xray": (".png", "image/png", b"\x89PNG\r\n\x1a\n", "PNG X-ray images"),
    "mri": (".pdf", "application/pdf", b"%PDF-", "PDF MRI reports"),
}


def read_diagnostic_upload(upload: UploadFile, kind: str) -> bytes:
    extension, mime, signature, label = POLICIES[kind]
    if not (upload.filename or "").lower().endswith(extension) or (upload.content_type or "").lower() != mime:
        raise HTTPException(415, f"Only {label} are accepted")
    content = upload.file.read(MAX_FILE_BYTES + 1)
    if len(content) > MAX_FILE_BYTES:
        raise HTTPException(413, "File exceeds 10 MiB")
    if not content:
        raise HTTPException(422, "Uploaded file is empty")
    if not content.startswith(signature):
        raise HTTPException(415, f"File content is not {mime}; renaming another format is not supported")
    return content
