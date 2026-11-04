from contextlib import asynccontextmanager

from uuid import UUID

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from app.api.review_workflow import router
from app.core.audit_ledger import append_event
from app.core.auth import Principal, require_roles
from app.models.case_record import CaseRecord
from app.core.config import Role, Settings
from app.core.crypto import FieldCipher
from app.core.database import Database
from app.core.middleware import LocalSafetyMiddleware
from app.schemas import RadiologyResult, ReportResult
from app.services.upload_policy import read_diagnostic_upload
from app.services import mri_nlp, prepared_illustrations, radiology_inference, report_extraction
from app.services.experimental_fracture import ExperimentalFractureAdapter


def create_app(settings: Settings | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app):
        config = settings or Settings.from_env()
        app.state.settings = config
        app.state.db = Database(config.database_url)
        app.state.cipher = FieldCipher(config.encryption_key)
        app.state.db.initialize()
        app.state.radiology = radiology_inference.RadiologyAdapter()
        app.state.experimental_radiology = ExperimentalFractureAdapter()
        app.state.experimental_radiology_ready = False
        if app.state.experimental_radiology.configured:
            try:
                # Validate the pinned graph and initialize the local CPU runtime once.
                app.state.experimental_radiology._load()
                app.state.experimental_radiology_ready = True
            except Exception:
                # Optional research capability must not prevent other workflows starting.
                pass
        app.state.mri = mri_nlp.MRIAdapter()
        try:
            yield
        finally:
            app.state.db.engine.dispose()

    application = FastAPI(title="Synthetic-data orthopedic review service", version="0.1.0", description="NOT CLINICALLY VALIDATED. Synthetic data only. No HIPAA certification or clinical production readiness is claimed.", lifespan=lifespan)
    application.add_middleware(LocalSafetyMiddleware)
    # Origins are opt-in and fixed, never derived from a browser request.
    import os
    if (settings and settings.dev_cors) or (settings is None and os.environ.get("DEV_CORS") == "true"):
        application.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000"], allow_credentials=False, allow_methods=["GET", "POST", "PUT"], allow_headers=["Authorization", "Content-Type"])
    application.include_router(router)

    @application.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        # Do not echo request inputs/free text back in validation errors.
        errors = [{"loc": error["loc"], "msg": error["msg"], "type": error["type"]} for error in exc.errors()]
        return JSONResponse(status_code=422, content={"detail": errors})

    @application.get("/api/health")
    def health(request: Request):
        return {"status": "ok", "mode": "local-synthetic-data-only", "presentationMode": request.app.state.settings.presentation_mode, "clinicallyValidated": False, "radiologyConfigured": bool(request.app.state.radiology.configured), "mriConfigured": bool(request.app.state.mri.configured), "experimentalRadiologyAvailable": bool(request.app.state.experimental_radiology_ready and request.app.state.experimental_radiology.configured), **report_extraction.capabilities()}

    def model_event(request, principal, case_id, adapter):
        with request.app.state.db.transaction() as session:
            record = session.get(CaseRecord, str(case_id)) if case_id else None
            if case_id and record is None:
                raise HTTPException(404, "Case not found")
            append_event(session, principal.subject, principal.role.value, "MODEL_INFER", str(case_id) if case_id else None, record.revision if record else None, model_info=adapter.provenance)

    def check_case(request, case_id):
        if case_id:
            with request.app.state.db.transaction() as session:
                if session.get(CaseRecord, str(case_id)) is None:
                    raise HTTPException(404, "Case not found")

    @application.post("/api/radiology/infer", response_model=RadiologyResult)
    def infer(request: Request, file: UploadFile = File(...), caseId: UUID | None = Form(None), principal: Principal = Depends(require_roles(Role.RADIOLOGIST))):
        try:
            check_case(request, caseId)
            content = read_diagnostic_upload(file, "xray")
            result = request.app.state.radiology.predict(content)
        finally:
            file.file.close()
        model_event(request, principal, caseId, request.app.state.radiology)
        return result

    @application.post("/api/radiology/experimental", response_model=None)
    def experimental_infer(request: Request, file: UploadFile = File(...), caseId: UUID | None = Form(None), principal: Principal = Depends(require_roles(Role.RADIOLOGIST))):
        try:
            check_case(request, caseId)
            content = read_diagnostic_upload(file, "xray")
            result = request.app.state.experimental_radiology.predict(content)
        finally:
            file.file.close()
        model_event(request, principal, caseId, request.app.state.experimental_radiology)
        return result

    @application.post("/api/radiology/prepared", response_model=None)
    def prepared_illustration(request: Request, file: UploadFile = File(...), caseId: UUID | None = Form(None), principal: Principal = Depends(require_roles(Role.RADIOLOGIST))):
        try:
            check_case(request, caseId)
            result = prepared_illustrations.lookup(read_diagnostic_upload(file, "xray"))
        finally:
            file.file.close()
        if result["matched"]:
            with request.app.state.db.transaction() as session:
                record = session.get(CaseRecord, str(caseId)) if caseId else None
                if caseId and record is None:
                    raise HTTPException(404, "Case not found")
                append_event(session, principal.subject, principal.role.value, "PREPARED_ILLUSTRATION", str(caseId) if caseId else None, record.revision if record else None)
        return result

    @application.post("/api/mri/extract", include_in_schema=False)
    def extract(principal: Principal = Depends(require_roles(Role.RADIOLOGIST))):
        raise HTTPException(410, "Direct report text input is disabled. Upload an MRI report PDF to /api/mri/report.")

    def report_event(request, principal, case_id, result):
        with request.app.state.db.transaction() as session:
            record = session.get(CaseRecord, str(case_id)) if case_id else None
            if case_id and record is None:
                raise HTTPException(404, "Case not found")
            append_event(session, principal.subject, principal.role.value, "REPORT_EXTRACT", str(case_id) if case_id else None, record.revision if record else None, report_info={"method": report_extraction.METHOD, "codeSha256": report_extraction.code_sha256(), "sourceSha256": result["sourceSha256"]})

    @application.post("/api/mri/report", response_model=ReportResult)
    def report_pdf(request: Request, file: UploadFile = File(...), caseId: UUID | None = Form(None), principal: Principal = Depends(require_roles(Role.RADIOLOGIST))):
        try:
            check_case(request, caseId)
            result = report_extraction.extract_pdf(read_diagnostic_upload(file, "mri"))
        finally:
            file.file.close()
        report_event(request, principal, caseId, result)
        return result

    @application.post("/api/mri/report-text", include_in_schema=False)
    def report_text(principal: Principal = Depends(require_roles(Role.RADIOLOGIST))):
        raise HTTPException(410, "Direct report text input is disabled. Upload an MRI report PDF to /api/mri/report.")

    return application


app = create_app()
