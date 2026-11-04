"use client";

import { useEffect, useState } from "react";
import { clinicalRequest, type Finding, type Modality } from "@/lib/clinical";
import { parseMriOutput, parseRadiologyOutput, type ReportEntity } from "@/lib/modelOutputs";

const LEGACY_UPLOADS_ENABLED = false;
function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
export default function ModelWorkbench({ token, caseId, modality, reportText, onAccept }: { token: string; caseId: string; modality: Modality; reportText: string; onAccept: (findings: Finding[]) => void }) {
  const [ready, setReady] = useState({ radiology: false, mri: false });
  const [file, setFile] = useState<File | null>(null);
  const [detections, setDetections] = useState<Finding[]>([]);
  const [extracted, setExtracted] = useState<ReportEntity[]>([]);
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    clinicalRequest("/health", token).then((value) => {
      if (active && object(value)) setReady({ radiology: value.radiologyConfigured === true, mri: value.mriConfigured === true });
    }).catch(() => { if (active) setError("Unable to check model configuration."); });
    return () => { active = false; };
  }, [token]);
  async function analyze() {
    if (!LEGACY_UPLOADS_ENABLED) return;
    setBusy(true); setError(""); setDetections([]); setExtracted([]); setModel("");
    try {
      let value: unknown;
      if (modality === "MR") value = await clinicalRequest("/mri/extract", token, "POST", { reportText, caseId }, 60000);
      else {
        if (!file) throw new Error("Select a synthetic PNG or JPEG radiograph.");
        const body = new FormData(); body.append("file", file); body.append("caseId", caseId);
        const response = await fetch("/clinical-api/radiology/infer", { method: "POST", body, cache: "no-store", credentials: "omit", redirect: "error", signal: AbortSignal.timeout(60000), headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) throw new Error(response.status === 503 ? "No approved local fracture model is configured." : "Radiology inference failed authorization, input validation, or model execution.");
        value = await response.json();
      }
      if (modality === "MR") {
        const result = parseMriOutput(value, reportText); setExtracted(result.entities); setModel(result.modelSha256);
      } else {
        const result = parseRadiologyOutput(value); setDetections(result.detections); setModel(result.modelSha256);
      }
    } catch (err) { setError(err instanceof Error ? err.message : "Model execution failed."); }
    finally { setBusy(false); }
  }
  if (!LEGACY_UPLOADS_ENABLED || (modality !== "XR" && modality !== "MR")) return null;
  const configured = modality === "MR" ? ready.mri : ready.radiology;
  return <section className="case-review" aria-label="Model-assisted research preview">
    <h3>{modality === "MR" ? "MRI report entity preview" : "Radiograph detection preview"}</h3>
    <p>Research only. Model configuration is not clinical approval. Outputs require independent review and are never automatically saved or signed.</p>
    {!configured && <p role="status">Unavailable: task-trained, checksum-pinned local model artifacts must be configured. No predictions are fabricated.</p>}
    {modality === "XR" && <label>Synthetic radiograph only (PNG/JPEG, maximum 10 MiB)<input type="file" accept="image/png,image/jpeg" disabled={!configured || busy} onChange={(e) => {
      const candidate = e.target.files?.[0] ?? null; setFile(null); setError("");
      if (candidate && (!['image/png', 'image/jpeg'].includes(candidate.type) || candidate.size > 10 * 1024 * 1024 || candidate.size === 0)) { setError("Select a nonempty PNG/JPEG of at most 10 MiB."); e.target.value = ""; return; }
      setFile(candidate);
    }} /></label>}
    <button disabled={!configured || busy || (modality === "MR" ? !reportText.trim() : !file)} onClick={() => void analyze()}>{busy ? "Running local model…" : "Preview model output"}</button>
    {error && <p className="case-error" role="alert">{error}</p>}
    {model && <><p style={{ overflowWrap: "anywhere" }}>Model SHA-256: {model}</p>{detections.length === 0 && extracted.length === 0 && <p>No findings returned. This does not exclude disease or injury.</p>}</>}
    {detections.length > 0 && <><ul>{detections.map((finding) => <li key={finding.id}>{finding.label} · confidence {finding.confidence ?? "unavailable"} · {finding.boneId ?? "unmapped anatomy"}</li>)}</ul><button onClick={() => { onAccept(detections); setDetections([]); setModel(""); }}>Add preview to unsaved findings for review</button></>}
    {extracted.length > 0 && <ul>{extracted.map((entity, index) => <li key={`${entity.start}-${index}`}>{entity.label}: {entity.text} · score {entity.score.toFixed(3)}</li>)}</ul>}
  </section>;
}
