"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { bones } from "@/data/anatomy";
import { clinicalRequest, parseAuditVerification, parseCase, parseClinicalSession, type CaseInput, type CaseRecord, type ClinicalSession, type Modality } from "@/lib/clinical";
import { fhirDiagnosticReport } from "@/utils/fhirDiagnosticReport";
import ReportWorkbench from "./ReportWorkbench";
import XrayWorkbench from "./XrayWorkbench";

const emptyInput = (): CaseInput => ({ patientPseudoId: "", dicomSeriesInstanceUid: null, reportText: "", modality: typeof window !== "undefined" && new URLSearchParams(window.location.search).get("modality") === "MR" ? "MR" : "XR", boneIds: [], findings: [] });
export default function CaseWorkspace() {
  const [tokenDraft, setTokenDraft] = useState("");
  const [token, setToken] = useState("");
  const [identity, setIdentity] = useState<ClinicalSession | null>(null);
  const [presentationMode, setPresentationMode] = useState<boolean | null>(null);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [checkingSession, setCheckingSession] = useState(true);
  const [records, setRecords] = useState<CaseRecord[]>([]);
  const [selected, setSelected] = useState<CaseRecord | null>(null);
  const [draft, setDraft] = useState<CaseInput>(() => ({ ...emptyInput(), modality: "XR" }));
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("modality") === "MR") queueMicrotask(() => setDraft((current) => ({ ...current, modality: "MR" })));
  }, []);
  const [findingLabel, setFindingLabel] = useState("");
  const [boneId, setBoneId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const session = useRef(0);
  const operationLock = useRef(false);
  useEffect(() => {
    let active = true;
    const generation = session.current;
    const initialize = async () => {
      try {
        const health = await clinicalRequest("/health", "");
        if (!active || generation !== session.current) return;
        if (typeof health !== "object" || health === null || !("presentationMode" in health) || health.presentationMode !== true) {
          setPresentationMode(false); return;
        }
        setPresentationMode(true);
        const connected = parseClinicalSession(await clinicalRequest("/session", ""));
        if (connected.presentationMode !== true) throw new Error("Local presentation access was not enabled by the backend.");
        const value = await clinicalRequest("/cases", "");
        if (!Array.isArray(value)) throw new Error("Invalid presentation case response.");
        const loaded = value.map(parseCase);
        if (active && generation === session.current) {
          setIdentity(connected); setToken(""); setTokenDraft(""); setRecords(loaded); setError("");
          setMessage("Local presentation ready. No access token is required. Use synthetic files only.");
        }
      } catch (err) {
        if (active && generation === session.current) setError(err instanceof Error ? err.message : "Unable to connect to the local presentation backend.");
      } finally { if (active && generation === session.current) setCheckingSession(false); }
    };
    void initialize();
    return () => { active = false; };
  }, [connectionAttempt]);
  const editable = identity?.role === "Radiologist" && (selected === null || selected.state !== "VERIFIED");
  function resetDraft() { setSelected(null); setDraft(emptyInput()); setFindingLabel(""); setBoneId(""); setReason(""); }
  function disconnect() {
    session.current += 1; operationLock.current = false; setBusy(false); setCheckingSession(false); setToken(""); setTokenDraft(""); setIdentity(null); setRecords([]); resetDraft(); setError(""); setMessage("");
  }
  async function run(action: (accessToken: string) => Promise<void>, accessToken = token) {
    if (operationLock.current) return;
    operationLock.current = true;
    const activeSession = session.current;
    setBusy(true); setError(""); setMessage("");
    try { await action(accessToken); }
    catch (err) { if (session.current === activeSession) setError(err instanceof Error ? err.message : "Request failed."); }
    finally { if (session.current === activeSession) { operationLock.current = false; setBusy(false); } }
  }
  async function refresh(accessToken: string) {
    const activeSession = session.current;
    const result = await clinicalRequest("/cases", accessToken);
    if (!Array.isArray(result)) throw new Error("The case list returned an invalid response.");
    const parsed = result.map(parseCase);
    if (session.current === activeSession) setRecords(parsed);
  }
  async function connect() {
    const accessToken = tokenDraft.trim();
    if (!accessToken) { setError("Enter a locally issued access token."); return; }
    const activeSession = session.current;
    await run(async () => {
      const authenticated = parseClinicalSession(await clinicalRequest("/session", accessToken));
      if (authenticated.role !== "ComplianceOfficer") await refresh(accessToken);
      if (session.current === activeSession) { setIdentity(authenticated); setToken(accessToken); setTokenDraft(""); setMessage(`Connected as ${authenticated.role}. Use synthetic records only.`); }
    }, accessToken);
  }
  function accept(record: CaseRecord) {
    setSelected(record); setDraft({ patientPseudoId: record.patientPseudoId, dicomSeriesInstanceUid: record.dicomSeriesInstanceUid, reportText: record.reportText, modality: record.modality, boneIds: [...record.boneIds], findings: record.findings.map((f) => ({ ...f })) }); setReason("");
    setRecords((current) => [record, ...current.filter((item) => item.id !== record.id)]);
  }
  async function load(id: string) {
    const activeSession = session.current;
    await run(async (accessToken) => { const record = parseCase(await clinicalRequest(`/cases/${id}`, accessToken)); if (session.current === activeSession) accept(record); });
  }
  async function save() {
    const activeSession = session.current;
    await run(async (accessToken) => {
      const body = selected ? { ...draft, expectedRevision: selected.revision } : draft;
      const record = parseCase(await clinicalRequest(selected ? `/cases/${selected.id}` : "/cases", accessToken, selected ? "PUT" : "POST", body));
      if (session.current === activeSession) { accept(record); setMessage("Saved to encrypted local storage. This does not certify clinical validity."); }
    });
  }
  async function review(action: "sign" | "amend") {
    if (!selected) return;
    const activeSession = session.current;
    await run(async (accessToken) => {
      const record = parseCase(await clinicalRequest(`/cases/${selected.id}/${action}`, accessToken, "POST", { expectedRevision: selected.revision, ...(action === "amend" ? { reason } : {}) }));
      if (session.current === activeSession) { accept(record); setMessage(action === "sign" ? "Review signature recorded. Two distinct radiologists are required for verification." : "Amendment opened. Save changes and obtain two new signatures."); }
    });
  }
  async function exportFhir() {
    if (!selected) return;
    const activeSession = session.current;
    await run(async (accessToken) => {
      const record = parseCase(await clinicalRequest(`/cases/${selected.id}/export`, accessToken));
      if (session.current !== activeSession) return;
      const bundle = fhirDiagnosticReport(record, { identifierSystem: "http://localhost/vitrion/synthetic-patient", reviewerIdentifierSystem: "http://localhost/vitrion/local-reviewer" });
      const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/fhir+json" }));
      const a = document.createElement("a"); a.href = url; a.download = `case-${record.id}.fhir.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("FHIR R4 collection exported. It contains sensitive clinical fields; use synthetic data only.");
    });
  }
  function addFinding() {
    if (!findingLabel.trim()) return;
    const finding = { id: crypto.randomUUID(), boneId: boneId || null, fmaId: null, label: findingLabel.trim(), confidence: null, boundingBox: null, displacementMm: null, aoOtaCode: null, radlexId: null };
    setDraft((current) => ({ ...current, findings: [...current.findings, finding], boneIds: [...new Set([...current.boneIds, ...(boneId ? [boneId] : [])])] })); setFindingLabel("");
  }
  const changed = selected !== null && JSON.stringify(draft) !== JSON.stringify({ patientPseudoId: selected.patientPseudoId, dicomSeriesInstanceUid: selected.dicomSeriesInstanceUid, reportText: selected.reportText, modality: selected.modality, boneIds: selected.boneIds, findings: selected.findings });
  return <main className="case-workspace">
    <header className="case-heading"><div><Link href="/">← Anatomical explorer</Link><h1>Research cases &amp; review</h1><p>Encrypted case records · dual-radiologist review · FHIR R4 export</p></div><span className="foundation-tag">LOCAL DEVELOPMENT · NO PHI</span></header>
    <aside className="case-warning" role="note"><strong>Not a clinically validated or HIPAA-certified deployment.</strong> Use synthetic data only. Written-report PDF processing produces source-grounded, rule-based draft fracture findings requiring review—not a validated LLM diagnosis. The local X-ray detector is experimental and requires reviewer-assigned anatomy; it does not recover an exact 3D fracture. No MRI image interpretation is performed.</aside>
    <section className="case-panel" aria-labelledby="session-title">
      <h2 id="session-title">{presentationMode ? "Local presentation session" : "Authorized session"}</h2>
      {checkingSession ? <p role="status">Connecting to the local workspace…</p> : !identity ? (presentationMode !== false
        ? <div className="case-actions"><span>Local presentation uses no access token. Synthetic data only.</span><button disabled={busy} onClick={() => { setCheckingSession(true); setConnectionAttempt((previous) => previous + 1); }}>Reconnect presentation</button></div>
        : <form onSubmit={(e) => { e.preventDefault(); void connect(); }} className="case-session">
          <label>Local JWT access token<input type="password" autoComplete="off" value={tokenDraft} onChange={(e) => setTokenDraft(e.target.value)} disabled={busy} required /></label>
          <button disabled={busy}>Connect</button><p>Issue a short-lived token using the backend CLI. Tokens are kept in memory, never browser storage.</p>
        </form>) : <div className="case-actions">
        <span>{identity.presentationMode ? "Presentation mode · isolated synthetic records · no token required." : `${identity.role}. Permissions are enforced by the server.`}</span>
        {identity?.role !== "ComplianceOfficer" && <button onClick={() => void run(refresh)} disabled={busy}>Refresh cases</button>}
        <button onClick={disconnect}>Disconnect &amp; clear</button>
        {identity?.role === "ComplianceOfficer" && <button onClick={() => void run(async (accessToken) => {
          const activeSession = session.current;
          const verification = parseAuditVerification(await clinicalRequest("/audit/verify", accessToken));
          if (session.current === activeSession) setMessage(`Audit chain verified: ${verification.entries} entries.`);
        })} disabled={busy}>Verify audit chain</button>}
      </div>}
    </section>
    {error && <p className="case-error" role="alert">{error}</p>}{message && <p className="case-message" role="status">{message}</p>}
    {busy && <p role="status">Processing authorized request…</p>}
    {identity && identity.role !== "ComplianceOfficer" && <div className="case-columns"><section className="case-panel" aria-labelledby="list-title"><div className="case-actions"><h2 id="list-title">Cases</h2><button disabled={busy || identity.role !== "Radiologist"} onClick={resetDraft}>New synthetic case</button></div>{records.length === 0 && <p>No cases are available to this account.</p>}<ul className="case-list">{records.map((record) => <li key={record.id}><button disabled={busy} aria-pressed={selected?.id === record.id} onClick={() => void load(record.id)}><strong>{record.modality} · {record.state}</strong><small>{record.id}</small><span>Revision {record.revision} · {record.findings.length} findings</span></button></li>)}</ul></section>
    <section className="case-panel" aria-labelledby="record-title">{!selected && draft.modality === "XR" && <XrayWorkbench token={token} caseId="" savedFindings={[]} onAccept={(findings) => setDraft((current) => ({ ...current, findings, boneIds: [...new Set(findings.flatMap((finding) => finding.boneId ? [finding.boneId] : []))] }))} />}<h2 id="record-title">{selected ? "Case record" : "New synthetic case"}</h2>{selected && <p>{selected.state} · revision {selected.revision} · {selected.signatures.filter((s) => s.revision === selected.revision).length}/2 signatures</p>}
      <form onSubmit={(e) => { e.preventDefault(); void save(); }}><fieldset disabled={busy || !editable} className="case-fields"><legend>Synthetic case details</legend>
        <label>Patient pseudo-ID<input maxLength={128} required value={draft.patientPseudoId} onChange={(e) => setDraft({ ...draft, patientPseudoId: e.target.value })} /></label>
        <label>Modality<select value={draft.modality} onChange={(e) => setDraft({ ...draft, modality: e.target.value as Modality })}><option value="XR">X-ray</option><option value="MR">MRI report (PDF only)</option><option value="CT" disabled>CT</option><option value="OT" disabled>Other</option></select></label>
        <label>DICOM Series Instance UID (optional)<input maxLength={64} value={draft.dicomSeriesInstanceUid ?? ""} readOnly title="DICOM input is disabled. Existing record linkage is retained." /></label>
        <label>Narrative report<textarea rows={5} maxLength={50000} value={draft.reportText} readOnly title="Direct report entry is disabled. Upload an MRI report PDF." /></label>
        <label>Finding anatomy<select value={boneId} disabled title="New findings must originate from the PNG or PDF processing workflow." onChange={(e) => setBoneId(e.target.value)}><option value="">Unspecified anatomy</option>{bones.map((bone) => <option key={bone.id} value={bone.id}>{bone.name}</option>)}</select></label>
        <label>Reviewer-entered finding<input maxLength={4000} value={findingLabel} readOnly title="Direct finding entry is disabled. Review findings from the uploaded PNG or PDF instead." /></label><button type="button" disabled onClick={addFinding}>Add finding</button>
        <ul className="case-findings">{draft.findings.map((finding) => <li key={finding.id}><span>{finding.label} · {finding.boneId ?? "Unspecified"}</span><button type="button" onClick={() => setDraft((current) => { const findings = current.findings.filter((f) => f.id !== finding.id); return { ...current, findings, boneIds: [...new Set(findings.flatMap((f) => f.boneId ? [f.boneId] : []))] }; })}>Remove</button>
          {finding.reportEvidence && <blockquote>{finding.reportEvidence.evidence.text}<small> · page {finding.reportEvidence.evidence.page} · {finding.reportEvidence.evidence.section} · {finding.reportEvidence.assertion}</small></blockquote>}
        </li>)}</ul>
        <p>Findings are manual entries, not AI predictions. No ontology identifiers, displacement measurements, or classification codes are guessed.</p><button type="submit">{selected ? "Save revision" : "Create case"}</button>
      </fieldset></form>
      {selected && !changed && editable && (selected.modality === "MR"
        ? <ReportWorkbench key={`${selected.id}-${selected.revision}`} token={token} caseId={selected.id} onAccept={(findings) => setDraft((current) => ({ ...current, findings: [...current.findings, ...findings.filter((finding) => !current.findings.some((existing) => existing.id === finding.id))], boneIds: [...new Set([...current.boneIds, ...findings.flatMap((finding) => finding.boneId ? [finding.boneId] : [])])] }))} />
        : selected.modality === "XR" ? <XrayWorkbench key={`${selected.id}-${selected.revision}`} token={token} caseId={selected.id} savedFindings={selected.findings} onAccept={(findings) => setDraft((current) => ({ ...current, findings: [...current.findings, ...findings.filter((finding) => !current.findings.some((existing) => existing.id === finding.id))], boneIds: [...new Set([...current.boneIds, ...findings.flatMap((finding) => finding.boneId ? [finding.boneId] : [])])] }))} /> : null)}
      {selected && <div className="case-review"><h3>Reviewed anatomy visualization</h3><p>Confirm findings before opening the reference skeleton. Approximate cracks are manually placed and not patient-specific reconstruction.</p>{selected.findings.filter((finding) => finding.boneId && finding.reportEvidence?.assertion !== "absent").map((finding) => <p key={finding.id}><Link className="case-anatomy-link" href={`/?bone=${encodeURIComponent(finding.boneId!)}&context=reviewed-finding&assertion=${finding.reportEvidence?.assertion === "uncertain" || finding.imageEvidence || finding.manualImageEvidence ? "uncertain" : "present"}`} target="_blank" rel="noopener noreferrer">Show {finding.boneId}: {finding.label} →</Link></p>)}</div>}
      {selected && <div className="case-review"><h3>Review &amp; export</h3>{changed && <p>Unsaved changes. Save or reload before signing or exporting.</p>}<div className="case-actions"><button disabled={busy || changed || identity?.presentationMode || identity?.role !== "Radiologist" || selected.state === "VERIFIED" || selected.findings.length === 0} onClick={() => void review("sign")}>Sign current revision</button><button disabled={busy || changed} onClick={() => void exportFhir()}>Export FHIR R4</button><button disabled={busy} onClick={() => void load(selected.id)}>Reload record</button></div>
        {selected.state === "VERIFIED" && identity?.role === "Radiologist" && <><label>Reason for amendment<input maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} /></label><button disabled={busy || identity.presentationMode || !reason.trim()} onClick={() => void review("amend")}>Open amendment</button></>}
        <p>{identity?.presentationMode ? "Clinical signatures and amendments are disabled in presentation mode. Demonstration records remain preliminary." : "Signing requires the Radiologist role. A second distinct radiologist must authenticate separately and review the same saved revision. Audit verification requires ComplianceOfficer."}</p>
      </div>}
    </section></div>}
    <section className="case-panel"><h2>Imaging integration</h2><p><Link href="/dicom" style={{ textDecoration: "underline" }}>Open the local synthetic DICOM viewer →</Link></p><p>DICOM Series UIDs can be linked to case records. Local-file viewing is separate from authenticated case access and does not establish PACS interoperability or de-identification. Calibrated measurements and clinically validated AI require additional approved artifacts. Do not supply patient images.</p></section>
  </main>;
}
