"use client";

import { ArrowDownToLine, ArrowUpRight, Crosshair, Info, Layers3, Link2, Scan, X } from "lucide-react";
import { sources } from "@/data/anatomy";
import { getBone } from "@/lib/anatomy";
import type { Bone, DisplayMode } from "@/lib/types";

interface Props {
  bone: Bone | undefined;
  loaded: boolean;
  mode: DisplayMode;
  onSelect: (id: string) => void;
  onMode: (mode: DisplayMode) => void;
  onFocus: () => void;
  onClear: () => void;
}

export default function BoneInformation({ bone, loaded, mode, onSelect, onMode, onFocus, onClear }: Props) {
  function exportBone() {
    if (!bone) return;
    const blob = new Blob([JSON.stringify({
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      application: "VITRION_01",
      disclaimer: "Reference catalog only. Not a diagnostic tool. Anatomical and clinical verification required.",
      modelMeshAvailable: loaded,
      bone,
      sources: sources.filter((source) => bone.sourceIds.includes(source.id)),
    }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `vitrion-${bone.id.toLowerCase()}.json`;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <aside id="bone-information" className="information-panel" aria-label="Bone information">
      <div className="panel-heading"><span className="eyebrow">ANATOMICAL RECORD</span><Info size={15} /></div>
      {!bone ? <div className="selection-empty"><div className="selection-icon"><Scan size={30} strokeWidth={1} /></div><h2>A closer understanding.</h2><p>Select a bone from the reference catalog or a connected 3D model to explore its anatomy.</p><span className="micro-label">INDIVIDUAL STRUCTURES. SHARED CONTEXT.</span></div> : <>
        <div className="bone-title"><div><span className="micro-label">{bone.region} / {bone.side}</span><h2>{bone.name}</h2>{bone.latinName && <p className="latin-name">{bone.latinName}</p>}</div><button className="icon-button" onClick={onClear} aria-label="Clear selected bone"><X size={16} /></button></div>
        <div className="bone-id"><code>{bone.id}</code><span className={loaded ? "status-dot ready" : "status-dot"} />{loaded ? "Mesh linked" : "No mesh"}</div>
        <div className="record-actions"><button disabled={!loaded} className="primary-button" onClick={onFocus}><Crosshair size={14} /> Focus</button><button disabled={!loaded} className={mode === "isolate" ? "small-button active" : "small-button"} onClick={() => onMode(mode === "isolate" ? "all" : "isolate")}><Scan size={14} /> {mode === "isolate" ? "Show all" : "Isolate"}</button></div>
        {!loaded && <p className="muted-note">3D controls activate when a licensed mesh is linked to this record.</p>}
        <section className="record-section"><h3>Overview <span>01</span></h3><dl className="facts"><div><dt>Division</dt><dd>{bone.division}</dd></div><div><dt>Group</dt><dd>{bone.group}</dd></div><div><dt>Classification</dt><dd>{bone.category} bone</dd></div><div><dt>Laterality</dt><dd>{bone.side}</dd></div><div><dt>Dimensions</dt><dd className="unavailable">Not sourced</dd></div><div><dt>Spatial coordinates</dt><dd className="unavailable">Asset-dependent</dd></div></dl></section>
        <section className="record-section"><h3>Function <span>02</span></h3>{bone.functions.length ? <ul className="fact-list">{bone.functions.map((text) => <li key={text}>{text}</li>)}</ul> : <p className="muted-note">Sourced functional details not yet curated.</p>}</section>
        <section className="record-section"><h3>Articulating bones <span>{String(bone.connectedBoneIds.length).padStart(2, "0")}</span></h3><div className="related-chips">{bone.connectedBoneIds.map((id) => <button key={id} onClick={() => onSelect(id)}><Link2 size={12} />{getBone(id)?.name ?? id}<ArrowUpRight size={12} /></button>)}</div>{!bone.connectedBoneIds.length && <p className="muted-note">No articulation records curated.</p>}<p className="muted-note">Curated references, not an exhaustive joint ontology.</p>{bone.joints.length > 0 && <p className="detail-text">{bone.joints.join(" · ")}</p>}<div className="stack-actions"><button disabled={!loaded} className={mode === "connected" ? "text-button active" : "text-button"} onClick={() => onMode(mode === "connected" ? "all" : "connected")}><Link2 size={14} />{mode === "connected" ? "Show full skeleton" : "Show connected bones"}</button><button disabled={!loaded} className={mode === "region" ? "text-button active" : "text-button"} onClick={() => onMode(mode === "region" ? "all" : "region")}><Layers3 size={14} />{mode === "region" ? "Show full skeleton" : "Show regional context"}</button></div><p className="muted-note">Regional context groups catalog records; it is not measured spatial proximity.</p></section>
        <section className="record-section"><h3>Landmarks <span>04</span></h3>{bone.landmarks.length ? <ul className="fact-list">{bone.landmarks.map((text) => <li key={text}>{text}</li>)}</ul> : <p className="muted-note">Landmarks not yet curated.</p>}</section>
        <section className="record-section"><h3>Clinical reference <span>05</span></h3>{bone.clinicalInformation.length ? <ul className="fact-list">{bone.clinicalInformation.map((text) => <li key={text}>{text}</li>)}</ul> : <p className="muted-note">No clinical claims or fracture measurements supplied for this record.</p>}<p className="muted-note">Reference only. Not a finding, diagnosis, or treatment recommendation.</p></section>
        {bone.counterpartId && <button className="counterpart-button" onClick={() => onSelect(bone.counterpartId!)}>Explore {getBone(bone.counterpartId)?.name ?? "opposite side"}<ArrowUpRight size={16} /></button>}
        <section className="record-section"><h3>Evidence &amp; provenance</h3><div className="source-list">{sources.filter((source) => bone.sourceIds.includes(source.id)).map((source) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer">{source.title}<ArrowUpRight size={13} /></a>)}</div><p className="muted-note">General anatomical references; terminology crosswalks and expert validation are not included.</p></section>
        <button className="export-button" onClick={exportBone}><ArrowDownToLine size={15} /> Export record &amp; sources <span>JSON</span></button>
      </>}
      <div className="panel-footer"><span className="status-dot" /> RESEARCH REFERENCE · NOT FOR DIAGNOSIS</div>
    </aside>
  );
}
