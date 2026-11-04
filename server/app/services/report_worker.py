"""Isolated, time-bounded PDF text extraction. No uploaded code is executed."""
import io
import json
import shutil
import subprocess
import sys
import time

from app.services import report_ocr

MAX_BYTES = 10 * 1024 * 1024
MAX_PAGES = 10
MAX_PIXELS = 40_000_000
MAX_TEXT = 200_000


def extract(content):
    from pypdf import PdfReader
    if len(content) > MAX_BYTES:
        raise ValueError("PDF exceeds 10 MiB")
    if not content.startswith(b"%PDF-"):
        raise ValueError("Not a PDF document")
    reader = PdfReader(io.BytesIO(content), strict=True)
    if reader.is_encrypted:
        raise ValueError("Encrypted PDFs are not supported")
    if not 1 <= len(reader.pages) <= MAX_PAGES:
        raise ValueError("PDF must contain 1 to 10 pages")
    pages, pixels, total_text = [], 0, 0
    deadline = time.monotonic() + 55
    document = None
    ocr_engine = None
    warnings = []
    try:
        for index, page in enumerate(reader.pages):
            text = page.extract_text() or ""
            method = "digital"
            if not text.strip():
                command = shutil.which("tesseract")
                if command is None and report_ocr.local_models() is None:
                    return {"status": 422, "detail": "REPORT_OCR_UNAVAILABLE: image-only/blank page; install local Tesseract or optional pinned RapidOCR dependencies, or paste report text"}
                try:
                    import pymupdf as fitz
                except ImportError:
                    return {"status": 503, "detail": "REPORT_OCR_UNAVAILABLE: local PDF rasterizer is not installed"}
                if document is None:
                    document = fitz.open(stream=content, filetype="pdf")
                pdf_page = document[index]
                rect = pdf_page.rect
                width, height = int(rect.width * 2 + 1), int(rect.height * 2 + 1)
                pixels += width * height
                if width < 1 or height < 1 or pixels > MAX_PIXELS:
                    raise ValueError("PDF rendered pixel budget exceeds 40 million pixels")
                pix = pdf_page.get_pixmap(matrix=fitz.Matrix(2, 2), colorspace=fitz.csGRAY, alpha=False)
                if pix.width * pix.height > width * height:
                    raise ValueError("PDF raster dimensions exceeded budget")
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise subprocess.TimeoutExpired("report", 55)
                if command is not None:
                    output = subprocess.run([command, "stdin", "stdout", "-l", "eng", "--psm", "3"], input=pix.tobytes("png"), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=remaining, check=True)
                    text = output.stdout.decode("utf-8", errors="replace")
                else:
                    if ocr_engine is None:
                        ocr_engine = report_ocr.create_engine()
                    text = report_ocr.recognize(ocr_engine, pix.tobytes("png"), warnings=warnings)
                    warning = "OCR engine: local RapidOCR 1.4.4 / pinned wheel-bundled PP-OCR ONNX models (Apache-2.0 package metadata). Recognition scores are not clinical accuracy; verify all text, especially negation and vertebral identifiers."
                    if warning not in warnings:
                        warnings.append(warning)
                if time.monotonic() > deadline:
                    raise subprocess.TimeoutExpired("report", 55)
                method = "ocr"
                if not text.strip():
                    raise ValueError("REPORT_NO_READABLE_TEXT: OCR found no written report text")
            total_text += len(text)
            if total_text > MAX_TEXT:
                raise ValueError("PDF extracted text exceeds 200000 characters")
            pages.append({"page": index + 1, "text": text, "extraction": method})
        return {"pages": pages, "warnings": warnings}
    finally:
        if document is not None:
            document.close()


def main():
    try:
        result = extract(sys.stdin.buffer.read(MAX_BYTES + 1))
    except subprocess.TimeoutExpired:
        result = {"status": 422, "detail": "REPORT_TIMEOUT: local report extraction exceeded 60 seconds"}
    except ImportError:
        result = {"status": 503, "detail": "REPORT_EXTRACTION_DEPENDENCY_UNAVAILABLE: required local PDF/OCR dependency is missing"}
    except ValueError as error:
        detail = str(error)
        if detail.startswith(("REPORT_OCR_", "REPORT_NO_READABLE_TEXT:")):
            result = {"status": 422, "detail": detail}
        else:
            result = {"status": 422, "detail": "REPORT_PDF_INVALID: malformed, encrypted, unreadable PDF or page/text/pixel limit exceeded"}
    except Exception:
        result = {"status": 422, "detail": "REPORT_PDF_INVALID: malformed, encrypted, unreadable PDF or page/text/pixel limit exceeded"}
    sys.stdout.write(json.dumps(result))


if __name__ == "__main__":
    main()
