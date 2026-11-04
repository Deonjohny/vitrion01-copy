"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { inspectDicom, renderGrayscale, validateDicomFiles, type DecodedDicom } from "@/lib/dicom";

const DICOM_UPLOADS_ENABLED = false;

export default function DicomWorkspace() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const generation = useRef(0);
  const images = useRef<DecodedDicom[]>([]);
  const [count, setCount] = useState(0);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [width, setWidth] = useState(256);
  const [level, setLevel] = useState(128);

  useEffect(() => () => { generation.current++; images.current = []; }, []);

  function draw(image: DecodedDicom, nextWidth: number, nextLevel: number) {
    const target = canvas.current;
    if (!target) return;
    target.width = image.columns; target.height = image.rows;
    const context = target.getContext("2d");
    if (!context) throw new Error("Canvas rendering is unavailable in this browser.");
    const rgba = renderGrayscale(image, nextWidth, nextLevel);
    const output = context.createImageData(image.columns, image.rows);
    output.data.set(rgba);
    context.putImageData(output, 0, 0);
  }

  function clear() {
    generation.current++;
    images.current = [];
    setCount(0); setIndex(0); setError(""); setBusy(false);
    if (canvas.current) { canvas.current.width = 1; canvas.current.height = 1; }
  }

  async function load(files: File[]) {
    if (!DICOM_UPLOADS_ENABLED) return;
    clear();
    const token = generation.current;
    setBusy(true);
    try {
      validateDicomFiles(files);
      const decoded: DecodedDicom[] = [];
      for (const file of files) {
        const buffer = await file.arrayBuffer();
        if (token !== generation.current) return;
        const image = inspectDicom(new Uint8Array(buffer));
        if (decoded.reduce((sum, item) => sum + item.pixels.byteLength, 0) + image.pixels.byteLength > 64 * 1024 * 1024) throw new Error("Decoded stack exceeds 64 MiB. Select fewer images.");
        decoded.push(image);
      }
      images.current = decoded;
      const image = decoded[0];
      draw(image, image.width, image.level);
      setWidth(image.width); setLevel(image.level); setCount(decoded.length);
    } catch (reason) {
      if (token !== generation.current) return;
      images.current = [];
      setError(reason instanceof Error && /^(Select|Only|Each|The selection|A DICOM|The DICOM|Supported images|DICOM pixel|Unsupported DICOM|Invalid DICOM|Decoded stack|Canvas rendering)/.test(reason.message) ? reason.message : "Unable to decode this synthetic DICOM; no file details are shown.");
    } finally { if (token === generation.current) setBusy(false); }
  }

  function select(next: number) {
    const image = images.current[next];
    if (!image) return;
    draw(image, image.width, image.level);
    setIndex(next); setWidth(image.width); setLevel(image.level);
  }

  function windowLevel(nextWidth: number, nextLevel: number) {
    const image = images.current[index];
    if (image) draw(image, nextWidth, nextLevel);
    setWidth(nextWidth); setLevel(nextLevel);
  }

  return <main className="dicom-workspace">
    <nav aria-label="Workspace navigation"><Link href="/">Anatomy workspace</Link> · <Link href="/cases">Cases workspace</Link></nav>
    <h1>Synthetic DICOM · local grayscale viewer</h1>
    <p className="dicom-warning"><strong>NO PHI — synthetic data only.</strong> Do not select patient images. Local processing is not de-identification. Research demonstration only, not for diagnosis or clinical use.</p>
    <p>Real DICOM pixels decoded with dicom-parser and rendered on a canvas. Limited decoder: single-frame 8/16-bit monochrome, uncompressed explicit/implicit VR little-endian Part 10 only. No compressed, color, multi-frame, presentation-state or VOI LUT support. Window center/width and rescale slope/intercept are supported.</p>
    <p>No uploads, browser storage, patient tags or filenames. Maximum 32 files, 16 MiB each, 64 MiB total encoded and decoded, 2048 × 2048 pixels. Clear images or leave this page to release image references; this is not guaranteed secure memory erasure.</p>
    <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> I confirm these files contain synthetic data only, with no PHI.</label>
    <div className="dicom-controls">
      <label>Select synthetic DICOM<input aria-label="Select synthetic DICOM" type="file" accept=".dcm,.dicom" multiple disabled={!DICOM_UPLOADS_ENABLED || !confirmed || busy} title="DICOM input is disabled. Only PNG X-rays and MRI report PDFs are accepted." onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; if (files.length) void load(files); }} /></label>
      <button disabled={!count && !busy} onClick={clear}>Clear images</button>
      <button disabled={!count || busy} onClick={() => select(index)}>Reset view</button>
      <button disabled={busy || index === 0 || !count} onClick={() => select(index - 1)}>Previous</button>
      <span aria-live="polite">{count ? `Image ${index + 1} of ${count}` : "No image loaded"}</span>
      <button disabled={busy || index >= count - 1} onClick={() => select(index + 1)}>Next</button>
      <label>Window width<input aria-label="Window width" type="range" min="1" max={Math.max(131072, width)} value={width} disabled={!count || busy} onChange={(event) => windowLevel(Number(event.target.value), level)} /></label>
      <label>Window level<input aria-label="Window level" type="range" min={Math.min(-65536, level)} max={Math.max(65536, level)} value={level} disabled={!count || busy} onChange={(event) => windowLevel(width, Number(event.target.value))} /></label>
    </div>
    <p>Stack order follows file selection, not anatomical position. Aspect ratio is in pixels; physical pixel spacing and orientation are not applied. No calibrated measurements.</p>
    <p role="status">{!DICOM_UPLOADS_ENABLED ? "DICOM input is disabled. Use Upload PNG X-ray Image or Upload MRI Report (PDF) in the case workspace." : busy ? "Decoding synthetic images locally…" : count ? `${count} synthetic image${count === 1 ? "" : "s"} loaded locally` : "Select synthetic DICOM files to begin."}</p>
    {error && <p role="alert">{error}</p>}
    <div className="dicom-viewport"><canvas ref={canvas} width="1" height="1" aria-label="Synthetic DICOM image viewport" role="img" /></div>
  </main>;
}
