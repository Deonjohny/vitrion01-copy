"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { bones } from "@/data/anatomy";
import type { Finding } from "@/lib/clinical";
import { diagnosticUploads, validateDiagnosticUpload } from "@/lib/uploadPolicy";
import { parseReportAnalysis, reviewedReportFinding, type ReportAnalysis } from "@/lib/reportAnalysis";

const names = new Map(bones.map((bone) => [bone.id, bone.name]));
export default function ReportWorkbench({ token, caseId, onAccept }: { token: string; caseId: string; onAccept: (findings: Finding[]) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<ReportAnalysis | null>(null);
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const [accepted, setAccepted] = useState(false);
  async function process() {
    if (busy || !file) return;
    const generation = ++sequence.current;
    setBusy(true); setError(""); setAnalysis(null); setReviewed(new Set()); setAccepted(false);
    try {
      await validateDiagnosticUpload(file, "mri");
      const body = new FormData(); body.append("file", file); body.append("caseId", caseId);
      const response = await fetch("/clinical-api/mri/report", { method: "POST", body, cache: "no-store", redirect: "error", credentials: "omit", signal: AbortSignal.timeout(90000), headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!response.ok) throw new Error(response.status === 413 ? "PDF exceeds the file/page/rendering limits." : response.status === 415 ? "Only PDF MRI reports are accepted." : response.status === 503 ? "PDF or OCR processing is unavailable. Retry after the local processing service is ready." : response.status === 422 ? "Unable to extract this PDF safely. It may be malformed, encrypted, image-only without OCR, or contain no readable report text." : "Report processing failed. Check session permissions and backend availability.");
      const value: unknown = await response.json();
      const parsed = parseReportAnalysis(value);
      if (sequence.current === generation) setAnalysis(parsed);
    } catch (err) { if (sequence.current === generation) setError(err instanceof Error ? err.message : "Report processing failed."); }
    finally { if (sequence.current === generation) setBusy(false); }
  }
  return <section className="case-review" aria-labelledby="report-workbench-title">
    <h3 id="report-workbench-title">Written MRI report → reviewed anatomy</h3>
    <p>Local PDF text extraction with conservative rule-based fracture matching—not an LLM or clinically validated interpretation. No MRI scan images are analyzed. Confirm each source statement and bone before accepting. Non-fracture abnormalities may remain unrecognized.</p>
    <label>{diagnosticUploads.mri.label}<input aria-label={diagnosticUploads.mri.label} type="file" accept={diagnosticUploads.mri.accept} disabled={busy} onChange={async (event) => {
      const input = event.currentTarget;
      const generation = ++sequence.current; setAnalysis(null); setReviewed(new Set()); setFile(null); setError(""); setAccepted(false);
      const candidate = input.files?.[0];
      if (!candidate) return;
      try { await validateDiagnosticUpload(candidate, "mri"); }
      catch (reason) { if (generation === sequence.current) { setError(reason instanceof Error ? reason.message : "Unable to read this PDF."); input.value = ""; } return; }
      if (generation === sequence.current) setFile(candidate);
    }} /></label>
    <div className="case-actions"><button disabled={busy || !file} onClick={() => void process()}>Extract written PDF</button></div>
    {busy && <p role="status">Extracting source text and checking fracture statements locally…</p>}
    {error && <p role="alert" className="case-error">{error}</p>}
    {analysis && <>
      <p role="status">{analysis.pages.length} page(s) extracted · {analysis.findings.length} draft statement(s) · {analysis.pages.some((p) => p.extraction === "ocr") ? "OCR used—verify transcription" : "Digital text"}</p>
      <p style={{ overflowWrap: "anywhere" }}>Source SHA-256: {analysis.sourceSha256}</p>
      {analysis.warnings.map((warning, index) => <p key={index} className="case-warning">{warning}</p>)}
      {analysis.findings.length === 0 && <p>No supported fracture statement was extracted. This does not establish a normal study or exclude injury.</p>}
      <ol className="report-results">{analysis.findings.map((finding) => <li key={finding.id} className="case-panel">
        <strong>{finding.label}</strong>
        <p>{finding.assertion.toUpperCase()} · {finding.temporality} · {finding.laterality} · {finding.boneId ? names.get(finding.boneId) : "Unresolved anatomy—manual review required"}</p>
        <blockquote style={{ margin: "12px 0", borderLeft: "2px solid #82613c", paddingLeft: 12, whiteSpace: "pre-wrap" }}>{finding.evidence.text}</blockquote>
        <small>Page {finding.evidence.page} · {finding.evidence.section} · source characters {finding.evidence.start}–{finding.evidence.end}</small>
        {finding.assertion !== "absent" && finding.boneId ? <>
          <label><span><input type="checkbox" style={{ width: "auto" }} checked={reviewed.has(finding.id)} onChange={(event) => setReviewed((current) => { const next = new Set(current); if (event.target.checked) next.add(finding.id); else next.delete(finding.id); return next; })} /> I reviewed this source statement and its anatomy{finding.assertion === "uncertain" ? "; this remains uncertain" : ""}.</span></label>
          {reviewed.has(finding.id) && <Link className="case-anatomy-link" href={`/?bone=${encodeURIComponent(finding.boneId)}&context=reviewed-report&assertion=${finding.assertion}`} target="_blank" rel="noopener noreferrer">Show reviewed {names.get(finding.boneId)} on 3D skeleton →</Link>}
        </> : <p>{finding.assertion === "absent" ? "Negative statement: not eligible for fracture highlighting." : "No anatomical ID was guessed."}</p>}
      </li>)}</ol>
      <button disabled={reviewed.size === 0 || accepted} onClick={() => {
        const findings = analysis.findings.filter((finding) => reviewed.has(finding.id)).map((finding) => reviewedReportFinding(analysis, finding));
        onAccept(findings); setAccepted(true);
      }}>Add reviewed findings to unsaved case</button>
      {accepted && <p role="status">Reviewed findings added to the draft. Save the case revision before signing.</p>}
      <details><summary>Inspect extracted written source</summary>{analysis.pages.map((page) => <section key={page.page}><h4>Page {page.page} · {page.extraction}</h4><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 350, overflowY: "auto" }}>{page.text}</pre></section>)}</details>
      <p>Skeleton links highlight a generic reference bone, not patient-specific fracture geometry. Place an approximate crack manually only after confirming its location; report wording alone does not define an exact 3D fracture.</p>
    </>}
  </section>;
}
