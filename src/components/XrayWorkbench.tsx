"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { bones } from "@/data/anatomy";
import { clinicalRequest, type Finding } from "@/lib/clinical";
import { parseRadiologyOutput } from "@/lib/modelOutputs";
import { diagnosticUploads, validateDiagnosticUpload } from "@/lib/uploadPolicy";
import { parsePreparedIllustration, type PreparedImageMatch } from "@/lib/preparedIllustrations";
import PreparedIllustration from "./PreparedIllustration";

interface ImageResult { sourceSha256: string; modelSha256: string; imageWidth: number; imageHeight: number; detections: Finding[]; warnings: string[] }
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
export default function XrayWorkbench({ token, caseId, savedFindings, onAccept }: { token: string; caseId: string; savedFindings: Finding[]; onAccept: (findings: Finding[]) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [prepared, setPrepared] = useState<PreparedImageMatch | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [preparedMessage, setPreparedMessage] = useState("");
  const [url, setUrl] = useState("");
  const [available, setAvailable] = useState(false);
  const [result, setResult] = useState<ImageResult | null>(null);
  const [mapped, setMapped] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sourceMessage, setSourceMessage] = useState("");
  const [drawing, setDrawing] = useState(false);
  const [trace, setTrace] = useState<[number, number][]>([]);
  const [manualBone, setManualBone] = useState("");
  const [manualConfirmed, setManualConfirmed] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const request = useRef(0);
  useEffect(() => {
    let active = true;
    const pending = request;
    clinicalRequest("/health", token).then((value) => { if (active && object(value)) setAvailable(value.experimentalRadiologyAvailable === true); }).catch(() => { if (active) setError("Unable to check experimental detector readiness."); });
    return () => { active = false; pending.current++; };
  }, [token]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  async function prepareImage(candidate: File, generation: number) {
    setPreparing(true); setPrepared(null); setPreparedMessage("");
    try {
      const body = new FormData(); body.append("file", candidate); if (caseId) body.append("caseId", caseId);
      const response = await fetch("/clinical-api/radiology/prepared", { method: "POST", body, cache: "no-store", credentials: "omit", redirect: "error", signal: AbortSignal.timeout(20000), headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!response.ok) throw new Error("Unable to load the prepared image illustration. Check the local processing service.");
      const parsed = parsePreparedIllustration(await response.json());
      if (generation !== request.current) return;
      if (parsed.matched) { setPrepared(parsed); setPreparedMessage(""); }
      else setPreparedMessage(parsed.message);
    } catch (reason) { if (generation === request.current) setPreparedMessage(reason instanceof Error ? reason.message : "Prepared illustration unavailable."); }
    finally { if (generation === request.current) setPreparing(false); }
  }
  async function analyze() {
    if (!file || busy) return;
    const generation = ++request.current;
    setBusy(true); setError(""); setResult(null); setMapped({}); setConfirmed(new Set());
    try {
      await validateDiagnosticUpload(file, "xray");
      const body = new FormData(); body.append("file", file); if (caseId) body.append("caseId", caseId);
      const response = await fetch("/clinical-api/radiology/experimental", { method: "POST", body, cache: "no-store", credentials: "omit", redirect: "error", signal: AbortSignal.timeout(90000), headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!response.ok) throw new Error(response.status === 413 ? "Image exceeds supported encoded-size/pixel limits." : response.status === 503 ? "The local research detector is not ready. No predictions were fabricated." : response.status === 415 ? "Only PNG X-ray images are accepted." : response.status === 422 ? "Image bytes could not be safely decoded as a PNG." : "Experimental inference failed. Check authorization and backend availability.");
      const value: unknown = await response.json();
      const parsed = parseRadiologyOutput(value);
      if (!object(value) || value.method !== "experimental-onnx-fracture-detector" || value.clinicallyValidated !== false || typeof value.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(value.sourceSha256) || !Number.isInteger(value.imageWidth) || Number(value.imageWidth) < 1 || !Number.isInteger(value.imageHeight) || Number(value.imageHeight) < 1 || !Array.isArray(value.warnings) || !value.warnings.every((w) => typeof w === "string")) throw new Error("Invalid image provenance or output metadata.");
      if (generation === request.current) setResult({ ...parsed, sourceSha256: value.sourceSha256, imageWidth: Number(value.imageWidth), imageHeight: Number(value.imageHeight), warnings: value.warnings });
    } catch (err) { if (generation === request.current) setError(err instanceof Error ? err.message : "Inference failed."); }
    finally { if (generation === request.current) setBusy(false); }
  }
  function selectedFindings() {
    if (!result) return [];
    return result.detections.filter((finding) => confirmed.has(finding.id) && mapped[finding.id]).map((finding) => ({
      ...finding, boneId: mapped[finding.id],
      imageEvidence: { sourceSha256: result.sourceSha256, modelSha256: result.modelSha256, method: "experimental-onnx-fracture-detector" as const, imageWidth: result.imageWidth, imageHeight: result.imageHeight, reviewerAssignedAnatomy: true as const },
    }));
  }
  return <section className="case-review" aria-labelledby="xray-workbench-title">
    <h3 id="xray-workbench-title">X-ray → experimental detection → reviewed bone</h3>
    <p className="case-warning">Real local fracture-only ONNX detector. <strong>Not clinically validated; may miss injuries or flag normal structures.</strong> It does not recognize the bone or left/right side. You must assign and confirm anatomy. Boxes are suspected regions, not exact crack outlines.</p>
    {!available && <p role="status">Research detector unavailable. Install/provision the pinned local artifact and optional runtime; no simulated results are shown.</p>}
    <label>{diagnosticUploads.xray.label}<input aria-label={diagnosticUploads.xray.label} type="file" accept={diagnosticUploads.xray.accept} disabled={busy} onChange={async (event) => {
      const input = event.currentTarget;
      const generation = ++request.current; setFile(null); setUrl(""); setResult(null); setPrepared(null); setPreparedMessage(""); setPreparing(false); setMapped({}); setConfirmed(new Set()); setError(""); setSourceMessage(""); setTrace([]); setManualBone(""); setManualConfirmed(false); setDrawing(false); setDimensions({ width: 0, height: 0 });
      const candidate = input.files?.[0];
      if (!candidate) return;
      try { await validateDiagnosticUpload(candidate, "xray"); }
      catch (reason) { if (generation === request.current) { setError(reason instanceof Error ? reason.message : "Unable to read this PNG."); input.value = ""; } return; }
      if (generation !== request.current) return;
      setFile(candidate);
      void prepareImage(candidate, generation);
      if (candidate) {
        setUrl(URL.createObjectURL(candidate));
        void candidate.arrayBuffer().then((bytes) => crypto.subtle.digest("SHA-256", bytes)).then((digest) => {
          if (generation !== request.current) return;
          const hash = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
          const previous = savedFindings.find((finding) => finding.manualImageEvidence?.sourceSha256 === hash);
          if (previous?.manualImageEvidence) {
            setTrace(previous.manualImageEvidence.points); setManualBone(previous.boneId ?? "");
            setSourceMessage("Restored saved reviewer trace: this file exactly matches its recorded SHA-256. Review again before changing or re-accepting it.");
          } else if (savedFindings.some((finding) => finding.manualImageEvidence)) setSourceMessage("This file does not match the saved trace source hash; no saved trace was overlaid.");
        }).catch(() => { if (generation === request.current) setError("Could not verify source image hash."); });
      }
    }} /></label>
    {preparing && <p role="status">Matching uploaded image content and loading its prepared 3D illustration…</p>}
    {preparedMessage && <p role="status">{preparedMessage}</p>}
    {prepared && <PreparedIllustration key={prepared.sourceSha256} illustration={prepared} />}
    <button disabled={busy || preparing || !file || !available} onClick={() => void analyze()}>{busy ? "Running actual local detector…" : "Run experimental fracture detection"}</button>
    {error && <p role="alert" className="case-error">{error}</p>}
    {sourceMessage && <p role="status">{sourceMessage}</p>}
    {savedFindings.some((finding) => finding.manualImageEvidence) && !file && <p>To inspect the saved reviewer trace, reselect its original source image. Its SHA-256 must match before the trace is overlaid; no patient image is retained in browser storage.</p>}
    {file && url && <div className="xray-evidence-image" style={{ cursor: drawing ? "crosshair" : "default" }} onClick={(event) => {
      if (!drawing || trace.length >= 64) return;
      const box = event.currentTarget.getBoundingClientRect();
      const point: [number, number] = [Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)), Math.max(0, Math.min(1, (event.clientY - box.top) / box.height))];
      setTrace((current) => [...current, point]); setManualConfirmed(false);
    }}>
      {/* The image is a temporary local file URL; it must not be optimized or uploaded to an image service. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="Uploaded synthetic X-ray source; review experimental boxes against this image" draggable={false} onLoad={(event) => setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} style={{ display: "block", width: "100%", height: "auto" }} />
      {trace.length > 0 && <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="Reviewer-drawn fracture trace, not AI segmentation" role="img" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
        <polyline points={trace.map(([x, y]) => `${x * 1000},${y * 1000}`).join(" ")} fill="none" stroke="#ffcb63" strokeWidth="4" />
        {trace.map(([x, y], index) => <circle key={index} cx={x * 1000} cy={y * 1000} r="5" fill="#120b0b" stroke="#ffcb63" strokeWidth="2" />)}
      </svg>}
      {result && <svg viewBox={`0 0 ${result.imageWidth} ${result.imageHeight}`} preserveAspectRatio="none" aria-label="Experimental suspected-fracture boxes" role="img" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
        {result.detections.map((finding, index) => {
          if (!finding.boundingBox) return null;
          const [ymin, xmin, ymax, xmax] = finding.boundingBox;
          return <g key={finding.id}><rect x={xmin * result.imageWidth} y={ymin * result.imageHeight} width={(xmax - xmin) * result.imageWidth} height={(ymax - ymin) * result.imageHeight} fill="none" stroke="#ff244b" strokeWidth={Math.max(result.imageWidth / 350, 2)} /><text x={xmin * result.imageWidth} y={Math.max(ymin * result.imageHeight - 6, 20)} fill="#ffcc83" stroke="#000" strokeWidth="0.5" fontSize={Math.max(result.imageWidth / 45, 14)}>{index + 1} · {Math.round((finding.confidence ?? 0) * 100)}% model score</text></g>;
        })}
      </svg>}
    </div>}
    {file && <section className="case-review" aria-label="Manual fracture source annotation">
      <h4>Reviewer-drawn source crack</h4>
      <p>If the experimental model misses or misplaces the break, trace it yourself on the original image. This is a manual annotation, not an AI prediction or a 3D reconstruction.</p>
      <div className="case-actions"><button aria-pressed={drawing} disabled={busy} onClick={() => setDrawing(!drawing)}>{drawing ? "Stop tracing" : "Draw fracture trace"}</button><button disabled={trace.length === 0} onClick={() => { setTrace((current) => current.slice(0, -1)); setManualConfirmed(false); }}>Undo last point</button><button disabled={trace.length === 0} onClick={() => { setTrace([]); setManualConfirmed(false); }}>Clear source trace</button></div>
      {drawing && <p role="status">Click successive points along the visible break. Maximum 64 points. {trace.length} placed.</p>}
      <label>Confirm bone and side for this manual trace<select aria-label="Bone for manual fracture trace" value={manualBone} onChange={(event) => { setManualBone(event.target.value); setManualConfirmed(false); }}><option value="">Choose reviewed anatomy…</option>{bones.map((bone) => <option key={bone.id} value={bone.id}>{bone.name} · {bone.id}</option>)}</select></label>
      <label><span><input type="checkbox" style={{ width: "auto" }} disabled={!manualBone || trace.length < 2} checked={manualConfirmed} onChange={(event) => setManualConfirmed(event.target.checked)} /> I reviewed the source trace and assigned anatomy; neither was automatically inferred.</span></label>
      {manualConfirmed && manualBone && <p><Link className="case-anatomy-link" href={`/?bone=${encodeURIComponent(manualBone)}&context=reviewed-finding&assertion=uncertain`} target="_blank" rel="noopener noreferrer">Show traced bone on 3D skeleton; place approximate surface crack →</Link></p>}
      <button disabled={!manualConfirmed || !file || dimensions.width < 1 || dimensions.height < 1 || busy} onClick={() => void (async () => {
        const generation = request.current; setBusy(true); setError("");
        try {
          const sourceSha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
          if (generation !== request.current) return;
          const xs = trace.map((point) => point[0]), ys = trace.map((point) => point[1]);
          const paddingX = 2 / dimensions.width, paddingY = 2 / dimensions.height;
          const boundingBox: [number, number, number, number] = [Math.max(0, Math.min(...ys) - paddingY), Math.max(0, Math.min(...xs) - paddingX), Math.min(1, Math.max(...ys) + paddingY), Math.min(1, Math.max(...xs) + paddingX)];
          onAccept([{ id: crypto.randomUUID(), boneId: manualBone, fmaId: null, label: "Reviewer-drawn suspected fracture trace — not AI detection", confidence: null, boundingBox, displacementMm: null, aoOtaCode: null, radlexId: null, manualImageEvidence: { sourceSha256, method: "reviewer-drawn-fracture-trace", imageWidth: dimensions.width, imageHeight: dimensions.height, points: trace, reviewerAssignedAnatomy: true } }]);
        } catch { setError("Unable to hash or accept the source annotation."); }
        finally { if (generation === request.current) setBusy(false); }
      })()}>Add reviewed manual trace to unsaved case</button>
    </section>}
    {result && <>
      <p role="status">Actual local model returned {result.detections.length} suspected region(s). {result.detections.length === 0 ? "This does not exclude injury." : "Confirm each against the original image."}</p>
      {result.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
      <details><summary>Model and source provenance</summary><p style={{ overflowWrap: "anywhere" }}>Model SHA-256: {result.modelSha256}<br />Source SHA-256: {result.sourceSha256}</p></details>
      <ol>{result.detections.map((finding, index) => <li className="case-panel" key={finding.id}>
        <strong>Suspected region {index + 1}</strong><p>Model score: {finding.confidence?.toFixed(3)}. Not a calibrated diagnostic probability.</p>
        <label>Reviewer-assigned bone and side<select aria-label={`Bone for region ${index + 1}`} value={mapped[finding.id] ?? ""} onChange={(event) => { setMapped((current) => ({ ...current, [finding.id]: event.target.value })); setConfirmed((current) => { const next = new Set(current); next.delete(finding.id); return next; }); }}><option value="">Choose after reviewing the source image…</option>{bones.map((bone) => <option key={bone.id} value={bone.id}>{bone.name} · {bone.id}</option>)}</select></label>
        <label><span><input type="checkbox" style={{ width: "auto" }} disabled={!mapped[finding.id]} checked={confirmed.has(finding.id)} onChange={(event) => setConfirmed((current) => { const next = new Set(current); if (event.target.checked) next.add(finding.id); else next.delete(finding.id); return next; })} /> I confirm the suspected region and assigned bone/side. These were not automatically recognized.</span></label>
        {confirmed.has(finding.id) && mapped[finding.id] && <Link className="case-anatomy-link" href={`/?bone=${encodeURIComponent(mapped[finding.id])}&context=reviewed-finding&assertion=uncertain`} target="_blank" rel="noopener noreferrer">Show reviewed bone on 3D skeleton →</Link>}
      </li>)}</ol>
      <button disabled={selectedFindings().length === 0} onClick={() => onAccept(selectedFindings())}>Add confirmed regions to unsaved case</button>
      <p>3D cracks remain manually positioned approximations. A bounding box does not establish the precise 3D fracture line. Save accepted findings before obtaining clinical review signatures.</p>
    </>}
  </section>;
}
