"""Optional pinned wheel-bundled OCR. Local CPU text recognition only, never image diagnosis."""
import hashlib
import importlib.metadata
import importlib.util
from functools import lru_cache
from pathlib import Path

MODEL_PINS = {
    "ch_PP-OCRv4_det_infer.onnx": "d2a7720d45a54257208b1e13e36a8479894cb74155a5efe29462512d42f49da9",
    "ch_PP-OCRv4_rec_infer.onnx": "48fc40f24f6d2a207a2b1091d3437eb3cc3eb6b676dc3ef9c37384005483683b",
    "ch_ppocr_mobile_v2.0_cls_infer.onnx": "e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c",
}


@lru_cache(maxsize=1)
def local_models():
    try:
        spec = importlib.util.find_spec("rapidocr_onnxruntime")
        if spec is None or spec.origin is None or importlib.metadata.version("rapidocr-onnxruntime") != "1.4.4":
            return None
        if any(importlib.util.find_spec(name) is None for name in ("onnxruntime", "numpy", "cv2")):
            return None
        directory = Path(spec.origin).parent / "models"
        paths = {}
        for name, checksum in MODEL_PINS.items():
            path = directory / name
            if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= 16 * 1024 * 1024:
                return None
            if hashlib.sha256(path.read_bytes()).hexdigest() != checksum:
                return None
            paths[name] = str(path.resolve())
        return paths
    except (ImportError, ValueError, OSError, importlib.metadata.PackageNotFoundError):
        return None


def create_engine():
    paths = local_models()
    if paths is None:
        raise ValueError("REPORT_OCR_UNAVAILABLE: pinned local RapidOCR models/dependencies unavailable")
    from rapidocr_onnxruntime import RapidOCR
    return RapidOCR(
        det_model_path=paths["ch_PP-OCRv4_det_infer.onnx"],
        rec_model_path=paths["ch_PP-OCRv4_rec_infer.onnx"],
        cls_model_path=paths["ch_ppocr_mobile_v2.0_cls_infer.onnx"],
        det_use_cuda=False, cls_use_cuda=False, rec_use_cuda=False,
        det_use_dml=False, cls_use_dml=False, rec_use_dml=False,
        intra_op_num_threads=2, inter_op_num_threads=1,
        text_score=0.0, print_verbose=False,
    )


def recognize(engine, png, warnings=None):
    import math
    rows, _ = engine(png, text_score=0.0)
    if not rows:
        raise ValueError("REPORT_NO_READABLE_TEXT: local OCR found no report text")
    if len(rows) > 2000:
        raise ValueError("REPORT_OCR_TEXT_LIMIT: too many recognized text regions")
    lines = []
    reliable_lines = 0
    for row in rows:
        text, score = str(row[1]).strip(), float(row[2])
        if not text:
            continue
        if not math.isfinite(score) or not 0 <= score <= 1:
            raise ValueError("REPORT_OCR_LOW_CONFIDENCE: invalid recognition score; paste verified report text instead")
        if score < 0.75:
            if len(text) > 1:
                raise ValueError("REPORT_OCR_LOW_CONFIDENCE: uncertain multi-character transcription; paste verified report text instead")
            warning = "OCR retained an isolated low-confidence one-character region in page text. It may be scan noise or meaningful text; verify it against the source. No potentially important multi-character clinical text was silently discarded."
            if warnings is not None and warning not in warnings:
                warnings.append(warning)
        else:
            reliable_lines += 1
        lines.append(text)
    if not reliable_lines:
        raise ValueError("REPORT_OCR_LOW_CONFIDENCE: no reliably recognized text regions; paste verified report text instead")
    text = "\n".join(lines)
    if not text.strip():
        raise ValueError("REPORT_NO_READABLE_TEXT: local OCR found no report text")
    return text
