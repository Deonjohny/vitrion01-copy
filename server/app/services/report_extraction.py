"""Conservative deterministic written-report drafts, not a clinical NLP model."""
import hashlib
import importlib.util
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException
from app.services.bone_registry import bone_ids
from app.services import report_ocr

METHOD = "rule-based-report-extraction"
MAX_BYTES = 10 * 1024 * 1024
FRACTURE = re.compile(r"\bfractur(?:e|es|ed|ing)(?:\b|(?=line\b))", re.I)
SECTION = re.compile(r"(?im)^[ \t]*(findings|impression|conclusion|(?:examination\s*/\s*)?technique|history|clinical (?:history|information|indication)|recommendations?|report status)[ \t]*[:\-]?[ \t]*(?:\r?\n)?")
# Uppercase only: lowercase t1/T1-weighted pulse sequences are not vertebral findings.
VERTEBRA = re.compile(r"(?<![A-Za-z0-9])(?:C[1-7]|T(?:1[0-2]|[1-9])|L[1-5]|S[1-5])(?:(?![A-Za-z0-9]|\s*[-–]?\s*(?:weighted|WI|W\b))|(?=(?i:vertebral(?:body)?\b)))")
UNCERTAIN = re.compile(r"\b(possible|possibly|suspect(?:ed|ing)?|suggestive|may|might|could|cannot exclude|can(?:not|'t) rule out|questionable|equivocal|indeterminate)\b", re.I)
NEGATED = re.compile(r"\b(no|without|negative for|absence of|absent|not (?:seen|identified|demonstrated)|no evidence of)\b", re.I)


def capabilities():
    pdf = importlib.util.find_spec("pypdf") is not None
    return {"reportPdfAvailable": pdf, "reportOcrAvailable": pdf and importlib.util.find_spec("fitz") is not None and (shutil.which("tesseract") is not None or report_ocr.local_models() is not None), "reportExtractionMethod": METHOD}


def code_sha256():
    worker = Path(__file__).with_name("report_worker.py")
    return hashlib.sha256(Path(__file__).read_bytes() + worker.read_bytes() + Path(report_ocr.__file__).read_bytes()).hexdigest()


def extract_pdf(content):
    if len(content) > MAX_BYTES:
        raise HTTPException(413, "PDF exceeds 10 MiB")
    if not content.startswith(b"%PDF-"):
        raise HTTPException(422, "REPORT_PDF_INVALID: not a PDF document")
    if not capabilities()["reportPdfAvailable"]:
        raise HTTPException(503, "REPORT_PDF_UNAVAILABLE: pypdf is not installed")
    try:
        result = subprocess.run([sys.executable, "-m", "app.services.report_worker"], input=content, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=60, check=True, cwd=str(Path(__file__).resolve().parents[2]))
        payload = json.loads(result.stdout)
    except subprocess.TimeoutExpired:
        raise HTTPException(422, "REPORT_TIMEOUT: local report extraction exceeded 60 seconds") from None
    except Exception:
        raise HTTPException(422, "REPORT_PDF_INVALID: local extraction failed") from None
    if "detail" in payload:
        raise HTTPException(payload.get("status", 422), payload["detail"])
    result = draft(payload["pages"], hashlib.sha256(content).hexdigest())
    result["warnings"].extend(payload.get("warnings", []))
    return result


def extract_text(text):
    if not text.strip():
        raise HTTPException(422, "REPORT_NO_READABLE_TEXT: report text is empty")
    return draft([{"page": 1, "text": text, "extraction": "digital"}], hashlib.sha256(text.encode("utf-8")).hexdigest())


def anatomy(clause, fracture, catalog):
    candidates = []
    for match in VERTEBRA.finditer(clause):
        if re.search(r"\b(?:low|high|hypo|hyper|on|and)\s*$", clause[max(0, match.start()-12):match.start()], re.I) or re.match(r"\s*(?:/|and\s+(?:high\s+)?(?:STIR|T2)|signal|sequence|weighted)", clause[match.end():], re.I):
            continue
        # Adjacent disk levels are not a single vertebral fracture localization.
        nearby = clause[max(0, match.start()-4):match.end()+4]
        if re.search(r"[CTL]\d\s*[-/]\s*[CTL]?\d|L\dL\d", nearby):
            continue
        candidates.append((match.start(), match.end(), match.group(), "Midline"))
    for match in re.finditer(r"\b(?:(right|left|bilateral)\s+)?nasal\s+bone(?:s)?(?:\s+(?:on\s+the\s+)?(right|left))?\b", clause, re.I):
        side = (match.group(1) or match.group(2) or "").lower()
        if not side:
            tail = clause[match.end():]
            suffix = re.match(r"\s*\(?\s*(right|left)\s*\)?", tail, re.I)
            side = suffix.group(1).lower() if suffix else ""
        if side in ("right", "left"):
            candidates.append((match.start(), match.end(), "NASAL_" + side.upper(), side.title()))
        else:
            candidates.append((match.start(), match.end(), None, "Unspecified"))
    if not candidates:
        return [(None, "Unspecified")]
    selected = [min(candidates, key=lambda x: min(abs(fracture.start()-x[1]), abs(x[0]-fracture.end())))]
    return [(identifier if identifier in catalog else None, side) for _, _, identifier, side in selected]


def draft(pages, source_hash):
    findings = []
    warnings = ["Deterministic rule-based written-report extraction; not clinically validated NLP or MRI image interpretation. All drafts require Radiologist review; omissions and assertion/anatomy errors are possible."]
    catalog = bone_ids()
    section = "Unspecified"
    for page in pages:
        text = page["text"]
        headings = list(SECTION.finditer(text))
        regions = []
        cursor = 0
        for heading in headings:
            regions.append((cursor, heading.start(), section))
            section = heading.group(1).title()
            cursor = heading.end()
        regions.append((cursor, len(text), section))
        for start, end, name in regions:
            if name not in ("Findings", "Impression", "Conclusion", "Unspecified"):
                continue
            # Sentence boundaries retain source offsets, including line wraps and Unicode.
            for sentence in re.finditer(r"[^.!?]+(?:[.!?]+|$)", text[start:end]):
                raw = sentence.group()
                left = len(raw) - len(raw.lstrip())
                right = len(raw.rstrip())
                a, b = start + sentence.start() + left, start + sentence.start() + right
                evidence = text[a:b]
                if not FRACTURE.search(evidence):
                    continue
                if name == "Unspecified" and headings:
                    continue
                if re.search(r"\b(?:evaluate for|history of|preferred|primary examination|if .*clinically required|may be considered|recommend|assessment of)\b", evidence, re.I):
                    continue
                # Contrast/semicolon boundaries keep normal adjacent anatomy out of fracture assertions.
                clauses = re.split(r";|\bbut\b|\bwhereas\b|\bwhile\b|,\s*(?=(?:the\s+)?(?:left|right)\b)", evidence, flags=re.I)
                for clause in clauses:
                    fractures = list(FRACTURE.finditer(clause))
                    for fracture in fractures:
                        # Restrict assertions to their own predicate when two fractures share a sentence.
                        prior = [m.end() for m in fractures if m.end() <= fracture.start()]
                        following = [m.start() for m in fractures if m.start() > fracture.start()]
                        local = clause[max(prior, default=0):min(following, default=len(clause))]
                        assertion = "uncertain" if UNCERTAIN.search(local) else "absent" if NEGATED.search(local) else "present"
                        temporal = "chronic" if re.search(r"\b(chronic|old|healed|remote)\b", local, re.I) else "acute" if re.search(r"\b(acute|recent|subacute)\b", local, re.I) else "unspecified"
                        for identifier, side in anatomy(clause, fracture, catalog):
                            item = {"id": str(uuid4()), "boneId": identifier, "label": (identifier + ": " if identifier else "Unresolved anatomy: ") + assertion + " fracture", "evidence": {"page": page["page"], "section": name, "text": evidence, "start": a, "end": b}, "assertion": assertion, "temporality": temporal, "laterality": side, "reviewRequired": True}
                            key = (identifier, assertion, a, b)
                            if not any((x["boneId"], x["assertion"], x["evidence"]["start"], x["evidence"]["end"]) == key and x["evidence"]["page"] == page["page"] for x in findings):
                                findings.append(item)
                            if identifier is None and "Unresolved anatomy retained as null; no catalog identifier was guessed." not in warnings:
                                warnings.append("Unresolved anatomy retained as null; no catalog identifier was guessed.")
    if len(findings) > 256:
        raise HTTPException(422, "REPORT_FINDING_LIMIT: more than 256 draft findings; split report explicitly")
    if any(p["extraction"] == "ocr" for p in pages):
        warnings.append("OCR text may contain recognition errors or omit entire lines; verify every assertion and report completeness against the original PDF. Missing OCR text is not evidence of absent findings.")
    if not findings:
        warnings.append("No explicit fracture assertion was recognized; this is not evidence of a normal examination.")
    return {"method": METHOD, "clinicallyValidated": False, "sourceSha256": source_hash, "pages": pages, "findings": findings, "warnings": warnings}
