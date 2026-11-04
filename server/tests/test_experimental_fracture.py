import hashlib
import io
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.services.experimental_fracture import ExperimentalFractureAdapter, MODEL_SHA256, suppress_boxes
from app.schemas import Finding
from conftest import authorization


def image_bytes(size=(400, 200)):
    from PIL import Image
    image = Image.new('RGB', size, (0, 0, 0))
    stream = io.BytesIO(); image.save(stream, format='PNG'); image.close()
    return stream.getvalue()


@pytest.fixture(scope='module')
def real_adapter():
    adapter = ExperimentalFractureAdapter()
    if not adapter.configured:
        pytest.skip('Pinned research ONNX artifact/optional dependencies not provisioned')
    adapter._load()
    return adapter


def test_nms_stable_overlap_and_limit():
    np = pytest.importorskip('numpy')
    boxes = np.array([[0,0,10,10], [1,1,9,9], [20,20,30,30]], dtype=np.float32)
    scores = np.array([.9,.9,.8], dtype=np.float32)
    assert suppress_boxes(boxes, scores) == [0,2]
    assert suppress_boxes(boxes, scores, maximum=1) == [0]
    assert suppress_boxes(np.empty((0,4)), np.empty(0)) == []


@pytest.mark.parametrize('size', [(400,200), (200,400)])
def test_real_pinned_onnx_preprocess_and_blank_image_not_clinical_normal(real_adapter, size, monkeypatch):
    import numpy as np
    actual_session = real_adapter._session
    inputs = []
    class RecordingSession:
        def run(self, names, values):
            inputs.append(values['images'].copy())
            return actual_session.run(names, values)
    monkeypatch.setattr(real_adapter, '_session', RecordingSession())
    content = image_bytes(size)
    result = real_adapter.predict(content)
    assert actual_session.get_providers() == ['CPUExecutionProvider']
    assert result['method'] == 'experimental-onnx-fracture-detector'
    assert result['modelSha256'] == MODEL_SHA256
    assert result['sourceSha256'] == hashlib.sha256(content).hexdigest()
    assert (result['imageWidth'], result['imageHeight']) == size
    assert result['clinicallyValidated'] is False
    assert any('No detections do not exclude injury' in warning for warning in result['warnings'])
    assert any('AGPL' in warning and 'MIT' in warning for warning in result['warnings'])
    tensor = inputs[0]
    assert tensor.shape == (1,3,640,640) and tensor.dtype == np.float32
    assert np.isfinite(tensor).all() and 0 <= tensor.min() <= tensor.max() <= 1
    assert tensor.max() == pytest.approx(114/255)
    assert tensor[:, :, 320, 320].max() == 0
    for detection in result['detections']:
        validated = Finding(**detection)
        assert validated.boneId is None and validated.displacementMm is None
        ymin,xmin,ymax,xmax = validated.boundingBox
        assert 0 <= ymin < ymax <= 1 and 0 <= xmin < xmax <= 1


def test_invalid_image_and_file_bounds_before_model():
    adapter = ExperimentalFractureAdapter()
    for content, status in [(b'',413), (b'x' * (10*1024*1024+1),413), (b'not-an-image',422)]:
        with pytest.raises(HTTPException) as failure:
            adapter.predict(content)
        assert failure.value.status_code == status


def test_experimental_api_preserves_envelope_auth_case_and_audit(local_service, synthetic_case):
    client, app, config = local_service
    case = client.post('/api/cases', headers=authorization(config), json=synthetic_case).json()
    response_body = {'modelSha256': MODEL_SHA256, 'detections': [], 'method': 'experimental-onnx-fracture-detector', 'clinicallyValidated': False, 'sourceSha256': 'a'*64, 'imageWidth':400, 'imageHeight':200, 'warnings':['Research only; negative detection does not establish a normal image']}
    app.state.experimental_radiology = SimpleNamespace(configured=True, predict=lambda _:response_body, provenance={'task':'experimental_fracture_detection','modelSha256':MODEL_SHA256,'manifestSha256':MODEL_SHA256})
    app.state.experimental_radiology_ready = True
    files = {'file':('ignored-private-filename.png',image_bytes(),'image/png')}
    assert client.post('/api/radiology/experimental', files=files).status_code == 401
    assert client.post('/api/radiology/experimental', files=files, headers=authorization(config,'research')).status_code == 403
    response = client.post('/api/radiology/experimental', files=files, data={'caseId':case['id']}, headers=authorization(config))
    assert response.status_code == 200 and response.json() == response_body
    assert client.post('/api/radiology/experimental', files=files, data={'caseId':str(uuid4())}, headers=authorization(config)).status_code == 404
    assert client.post('/api/radiology/experimental', files={'file':('file.pdf',b'%PDF-','application/pdf')}, headers=authorization(config)).status_code == 415
    assert client.post('/api/radiology/experimental', files={'file':('file.png',b'x'*(10*1024*1024+1),'image/png')}, headers=authorization(config)).status_code == 413
    assert client.post('/api/radiology/experimental', content=b'x'*(12*1024*1024+1), headers=authorization(config)).status_code == 413
    assert client.get('/api/cases/'+case['id'], headers=authorization(config)).json() == case
    events = client.get('/api/audit/events', headers=authorization(config,'compliance')).json()
    models = [e['payload'] for e in events if e['payload']['action']=='MODEL_INFER']
    assert len(models)==1 and models[0]['model']['modelSha256']==MODEL_SHA256
    assert 'ignored-private-filename' not in str(events)
    assert client.get('/api/health').json()['experimentalRadiologyAvailable'] is True


def test_actual_model_route_and_health(local_service, real_adapter):
    client, app, config = local_service
    app.state.experimental_radiology = real_adapter
    app.state.experimental_radiology_ready = True
    result = client.post('/api/radiology/experimental', files={'file':('blank.png',image_bytes(),'image/png')}, headers=authorization(config))
    assert result.status_code == 200
    assert result.json()['modelSha256']==MODEL_SHA256 and result.json()['clinicallyValidated'] is False
    health = client.get('/api/health').json()
    assert health['experimentalRadiologyAvailable'] is True
    assert health['clinicallyValidated'] is False
    assert health['radiologyConfigured'] is False


def test_image_provenance_round_trip_and_validation(local_service, synthetic_case):
    client, _, config = local_service
    evidence = {'sourceSha256':'a'*64,'modelSha256':MODEL_SHA256,'method':'experimental-onnx-fracture-detector','imageWidth':400,'imageHeight':200,'reviewerAssignedAnatomy':True}
    synthetic_case['findings'][0]['imageEvidence'] = evidence
    response = client.post('/api/cases', json=synthetic_case, headers=authorization(config))
    assert response.status_code == 201 and response.json()['findings'][0]['imageEvidence']==evidence
    for changes in ({'imageWidth':0}, {'imageHeight':1.5}, {'reviewerAssignedAnatomy':False}, {'sourceSha256':'invalid'}):
        with pytest.raises(ValueError):
            Finding(id=uuid4(), boneId='C6', label='Reviewer confirmed', imageEvidence={**evidence,**changes})
