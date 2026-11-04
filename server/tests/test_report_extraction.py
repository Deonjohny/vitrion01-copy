import hashlib
import io
import json
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from app.schemas import Finding
from app.services import report_extraction as reports
from app.services.report_worker import extract as worker_extract
from conftest import authorization


def pdf(text=None, pages=1):
    writer = PdfWriter()
    for _ in range(pages):
        page = writer.add_blank_page(width=612, height=792)
        if text is not None:
            font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
            page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
            stream = DecodedStreamObject()
            stream.set_data(('BT /F1 12 Tf 20 700 Td (' + text + ') Tj ET').encode('ascii'))
            page[NameObject('/Contents')] = writer._add_object(stream)
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


@pytest.mark.parametrize('text,bone,assertion', [
    ('Findings: Acute compression fracture of C6.', 'C6', 'present'),
    ('Impression: Possible right nasal bone fracture.', 'NASAL_RIGHT', 'uncertain'),
    ('Findings: No fracture at T8.', 'T8', 'absent'),
    ('Impression: Suspected chronic L1 fracture.', 'L1', 'uncertain'),
    ('Findings: No evidence of left nasal bone fracture.', 'NASAL_LEFT', 'absent'),
    ('Findings: Cannot exclude L1 fracture.', 'L1', 'uncertain'),
    ('Findings: Fracture of an unidentified bone.', None, 'present'),
])
def test_assertions(text, bone, assertion):
    result = reports.extract_text(text)
    finding = result['findings'][0]
    assert finding['boneId'] == bone and finding['assertion'] == assertion
    assert result['sourceSha256'] == hashlib.sha256(text.encode()).hexdigest()
    evidence = finding['evidence']
    assert text[evidence['start']:evidence['end']] == evidence['text']
    assert finding['reviewRequired'] is True and result['clinicallyValidated'] is False


def test_no_sequence_disc_or_normal_neighbor_false_localization():
    text = 'Findings:\nLow T1 and high STIR signal in the setting of an acute fracture. Mild L4-L5 disc desiccation. Right nasal bone fracture; the left nasal bone is normal.'
    findings = reports.extract_text(text)['findings']
    assert [(f['boneId'], f['assertion']) for f in findings] == [(None, 'present'), ('NASAL_RIGHT', 'present')]
    assert reports.extract_text('Findings: T1-weighted and STIR images. No abnormality.')['findings'] == []


def test_sections_unicode_and_no_history_as_diagnosis():
    text = 'CLINICAL INDICATION\nEvaluate for C6 fracture.\nFINDINGS\nÉvidence: suspected C6 fracture.\nIMPRESSION\nNo T8 fracture.'
    result = reports.extract_text(text)
    assert [(f['boneId'], f['assertion'], f['evidence']['section']) for f in result['findings']] == [('C6', 'uncertain', 'Findings'), ('T8', 'absent', 'Impression')]
    for f in result['findings']:
        e = f['evidence']; assert text[e['start']:e['end']] == e['text']


def test_real_digital_pdf_and_bounds():
    content = pdf('Findings: Acute C6 fracture.')
    result = reports.extract_pdf(content)
    assert result['sourceSha256'] == hashlib.sha256(content).hexdigest()
    assert result['findings'][0]['boneId'] == 'C6'
    assert result['pages'][0]['extraction'] == 'digital'
    for content in (b'not PDF', pdf(pages=11), b'%PDF-' + b'x' * reports.MAX_BYTES):
        with pytest.raises(HTTPException) as failure:
            reports.extract_pdf(content)
        assert failure.value.status_code in (413, 422)


def test_ocr_unavailable_is_not_empty_success(monkeypatch):
    monkeypatch.setattr('app.services.report_worker.shutil.which', lambda _: None)
    monkeypatch.setattr('app.services.report_worker.report_ocr.local_models', lambda: None)
    assert worker_extract(pdf())['status'] == 422


def test_ocr_render_pixel_budget(monkeypatch):
    monkeypatch.setattr('app.services.report_worker.shutil.which', lambda _: 'tesseract')
    writer = PdfWriter();writer.add_blank_page(width=20000, height=20000)
    output = io.BytesIO();writer.write(output)
    with pytest.raises(ValueError, match='pixel budget'):
        worker_extract(output.getvalue())


def test_pdf_timeout(monkeypatch):
    import subprocess
    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired('report', 60)
    monkeypatch.setattr(reports.subprocess, 'run', timeout)
    with pytest.raises(HTTPException) as failure:
        reports.extract_pdf(b'%PDF-test')
    assert failure.value.status_code == 422 and 'TIMEOUT' in failure.value.detail


def test_report_routes_auth_audit_and_no_persistence(local_service, synthetic_case):
    client, app, config = local_service
    case = client.post('/api/cases', headers=authorization(config), json=synthetic_case).json()
    for route in ('report', 'report-text'):
        kwargs = {'json': {'reportText': 'Findings: C6 fracture.'}} if route == 'report-text' else {'files': {'file': ('ignored.pdf', pdf('Findings: C6 fracture.'), 'application/pdf')}}
        assert client.post('/api/mri/' + route, **kwargs).status_code == 401
        assert client.post('/api/mri/' + route, headers=authorization(config, 'research'), **kwargs).status_code == 403
        assert client.post('/api/mri/' + route, headers=authorization(config), **kwargs).status_code == (410 if route == 'report-text' else 200)
    text = 'Findings: SYNTHETIC-PRIVATE-MARKER acute C6 fracture.'
    upload = {'file': ('synthetic.pdf', pdf(text), 'application/pdf')}
    result = client.post('/api/mri/report', headers=authorization(config), files=upload, data={'caseId': case['id']})
    assert result.status_code == 200
    assert client.post('/api/mri/report', headers=authorization(config), files=upload, data={'caseId': str(uuid4())}).status_code == 404
    events = client.get('/api/audit/events', headers=authorization(config, 'compliance')).json()
    report_events = [e['payload'] for e in events if e['payload']['action'] == 'REPORT_EXTRACT']
    assert len(report_events) == 2
    assert set(report_events[-1]['report']) == {'method', 'codeSha256', 'sourceSha256'}
    assert 'SYNTHETIC-PRIVATE-MARKER' not in json.dumps(events)
    assert client.get('/api/cases/' + case['id'], headers=authorization(config)).json() == case
    assert client.get('/api/audit/verify', headers=authorization(config, 'compliance')).json()['valid']
    health = client.get('/api/health').json()
    assert health['reportPdfAvailable'] is True and health['reportExtractionMethod'] == reports.METHOD


@pytest.mark.parametrize('box', [[0,0,0,1], [0,0,1,0], [0,0,1.1,1], [-.1,0,1,1]])
def test_strict_boxes(box):
    with pytest.raises(ValueError):
        Finding(id=uuid4(), boneId='C6', label='Synthetic', boundingBox=box)


def test_registry_matches_frontend_when_available():
    from app.services.bone_registry import REGISTRY_PATH, valid_bone
    source = Path(__file__).resolve().parents[2] / 'src' / 'data' / 'bone-ids.json'
    if source.exists():
        assert REGISTRY_PATH.read_bytes() == source.read_bytes()
    with pytest.raises(ValueError):
        valid_bone('not-in-catalog')


def test_local_ocr_path_is_explicit_and_bounded(monkeypatch):
    from types import SimpleNamespace
    monkeypatch.setattr('app.services.report_worker.shutil.which', lambda _: 'local-tesseract')
    calls = []
    def run(command, **kwargs):
        calls.append((command, kwargs))
        return SimpleNamespace(stdout=b'Findings: Possible right nasal bone fracture.')
    monkeypatch.setattr('app.services.report_worker.subprocess.run', run)
    result = worker_extract(pdf())
    assert result['pages'][0]['extraction'] == 'ocr'
    draft = reports.draft(result['pages'], 'a' * 64)
    assert draft['findings'][0]['boneId'] == 'NASAL_RIGHT'
    assert draft['findings'][0]['assertion'] == 'uncertain'
    assert calls[0][0] == ['local-tesseract', 'stdin', 'stdout', '-l', 'eng', '--psm', '3']
    assert 0 < calls[0][1]['timeout'] <= 55
    assert calls[0][1]['input'].startswith(b'\x89PNG')


def test_image_and_pdf_file_limits_precede_adapters(local_service):
    client, app, config = local_service
    for route, name, content_type in [('/api/radiology/infer', 'x.png', 'image/png'), ('/api/mri/report', 'x.pdf', 'application/pdf')]:
        response = client.post(route, headers=authorization(config), files={'file': (name, b'x' * (10 * 1024 * 1024 + 1), content_type)})
        assert response.status_code == 413
    response = client.post('/api/mri/report', headers=authorization(config), content=b'x' * (12 * 1024 * 1024 + 1))
    assert response.status_code == 413


def test_reviewer_evidence_round_trip(local_service, synthetic_case):
    client, _, config = local_service
    report = reports.extract_text('Findings: Possible C6 fracture.')
    f = report['findings'][0]
    synthetic_case['findings'][0]['reportEvidence'] = {key: f[key] for key in ('assertion', 'temporality', 'laterality', 'evidence')}
    synthetic_case['findings'][0]['reportEvidence'].update(sourceSha256=report['sourceSha256'], method=report['method'])
    response = client.post('/api/cases', headers=authorization(config), json=synthetic_case)
    assert response.status_code == 201
    assert response.json()['findings'][0]['reportEvidence'] == synthetic_case['findings'][0]['reportEvidence']


def test_health_missing_model_artifacts_is_not_ready(monkeypatch):
    from app.services.mri_nlp import MRIAdapter
    from app.services.radiology_inference import RadiologyAdapter
    monkeypatch.setenv('LOCAL_MODELS_ENABLED', 'true')
    monkeypatch.setenv('MRI_MODEL_DIR', str(Path(__file__).parent / 'does-not-exist'))
    monkeypatch.setenv('MRI_MANIFEST_SHA256', 'a' * 64)
    monkeypatch.setenv('YOLO_WEIGHTS_PATH', str(Path(__file__).parent / 'does-not-exist.pt'))
    assert MRIAdapter().configured is False
    assert RadiologyAdapter().configured is False
