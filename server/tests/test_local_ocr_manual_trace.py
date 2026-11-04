import socket
from uuid import uuid4

import pytest

from app.schemas import Finding
from app.services import report_ocr
from app.services.report_extraction import extract_pdf, capabilities
from conftest import authorization


def raster_pdf():
    import pymupdf
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((60, 100), 'FINDINGS', fontsize=20)
    page.insert_text((60, 150), 'Acute compression fracture of C6.', fontsize=18)
    page.insert_text((60, 220), 'IMPRESSION', fontsize=20)
    page.insert_text((60, 270), 'Suspected T8 fracture.', fontsize=18)
    raster = pymupdf.open()
    target = raster.new_page()
    target.insert_image(target.rect, stream=page.get_pixmap(matrix=pymupdf.Matrix(2,2)).tobytes('png'))
    content = raster.tobytes()
    raster.close(); document.close()
    return content


def test_real_offline_raster_pdf_c6_t8_evidence():
    if report_ocr.local_models() is None:
        pytest.skip('Optional pinned wheel-bundled RapidOCR models not installed')
    result = extract_pdf(raster_pdf())
    assert capabilities()['reportOcrAvailable'] is True
    assert result['pages'][0]['extraction'] == 'ocr'
    assert [(f['boneId'],f['assertion']) for f in result['findings']] == [('C6','present'),('T8','uncertain')]
    for finding in result['findings']:
        e = finding['evidence']
        assert result['pages'][0]['text'][e['start']:e['end']] == e['text']
    assert any('RapidOCR' in warning for warning in result['warnings'])


def test_real_ocr_engine_performs_no_network(monkeypatch):
    if report_ocr.local_models() is None:
        pytest.skip('Optional local OCR not installed')
    def blocked(*args, **kwargs):
        raise AssertionError('OCR attempted network access')
    monkeypatch.setattr(socket.socket, 'connect', blocked)
    monkeypatch.setattr(socket, 'create_connection', blocked)
    import pymupdf
    document = pymupdf.open(stream=raster_pdf(), filetype='pdf')
    png = document[0].get_pixmap(matrix=pymupdf.Matrix(2,2)).tobytes('png')
    text = report_ocr.recognize(report_ocr.create_engine(), png)
    document.close()
    assert 'C6' in text and 'T8' in text


def test_ocr_low_confidence_rejected_not_silent_partial_success():
    engine = lambda *args, **kwargs: ([[[], 'No C6 fracture.', 0.6]], None)
    with pytest.raises(ValueError, match='LOW_CONFIDENCE'):
        report_ocr.recognize(engine, b'unused')


def test_manual_image_trace_roundtrip(local_service, synthetic_case):
    client, _, config = local_service
    trace = {'sourceSha256':'a'*64,'method':'reviewer-drawn-fracture-trace','imageWidth':400,'imageHeight':200,'points':[[0.2,0.3],[0.4,0.5]],'reviewerAssignedAnatomy':True}
    synthetic_case['findings'][0]['manualImageEvidence'] = trace
    result = client.post('/api/cases',headers=authorization(config),json=synthetic_case)
    assert result.status_code == 201
    assert result.json()['findings'][0]['manualImageEvidence'] == trace
    for changes in ({'points':[[0,0]]},{'points':[[0,0]]*65},{'points':[[0,0],[2,0]]},{'points':[[0,0],[0,0]]},{'points':[[0,0],[float('nan'),.5]]},{'imageWidth':0},{'reviewerAssignedAnatomy':False}):
        with pytest.raises(ValueError):
            Finding(id=uuid4(),boneId='C6',label='Reviewed trace',manualImageEvidence={**trace,**changes})


def test_low_confidence_isolated_character_is_retained_with_warning():
    engine = lambda *args, **kwargs: ([[[], 'FINDINGS', .99], [[], '|', .2], [[], 'C6 fracture.', .99]], None)
    warnings = []
    text = report_ocr.recognize(engine, b'unused', warnings=warnings)
    assert text == 'FINDINGS\n|\nC6 fracture.'
    assert len(warnings) == 1 and 'one-character' in warnings[0]
    all_noise = lambda *args, **kwargs: ([[[], '|', .2]], None)
    with pytest.raises(ValueError, match='LOW_CONFIDENCE'):
        report_ocr.recognize(all_noise, b'unused', warnings=[])


def test_actual_pdf_upload_pil_raster_spawn_workflow(local_service):
    if report_ocr.local_models() is None:
        pytest.skip('Optional pinned local OCR not installed')
    import io
    import pymupdf
    from PIL import Image
    client, _, config = local_service
    original = pymupdf.open(stream=raster_pdf(), filetype='pdf')
    pix = original[0].get_pixmap(matrix=pymupdf.Matrix(1.5,1.5))
    image = Image.frombytes('RGB', [pix.width,pix.height], pix.samples)
    derivative = io.BytesIO(); image.save(derivative, format='PDF')
    image.close(); original.close()
    response = client.post('/api/mri/report', headers=authorization(config), files={'file':('generated-raster.pdf',derivative.getvalue(),'application/pdf')})
    assert response.status_code == 200, response.json()
    result = response.json()
    assert result['pages'][0]['extraction'] == 'ocr'
    assert [(f['boneId'],f['assertion']) for f in result['findings']] == [('C6','present'),('T8','uncertain')]
    for f in result['findings']:
        e = f['evidence']; assert result['pages'][e['page']-1]['text'][e['start']:e['end']] == e['text']


def test_ocr_joined_anatomy_word_keeps_exact_source_and_not_sequence():
    from app.services.report_extraction import extract_text
    text = 'FINDINGS\nAcute compression fracture involving the C6vertebral body. A subtle fractureline is seen. Low T1signal in the setting of a fracture.'
    findings = extract_text(text)['findings']
    assert [(f['boneId'],f['assertion']) for f in findings] == [('C6','present'),(None,'present'),(None,'present')]
    for finding in findings:
        e = finding['evidence']; assert text[e['start']:e['end']] == e['text']
