"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Activity, ArrowRight, ArrowUpRight, Bone as BoneIcon, Box, ChevronDown, ChevronRight, CircleHelp, Crosshair, Database, Fingerprint, Focus, Layers3, Link2, Menu, Microscope, Minus, Move3D, Plus, RotateCcw, Search, Settings2, ShieldCheck, SlidersHorizontal, X } from "lucide-react";
import { bones, sources } from "@/data/anatomy";
import { getBone, getRelatedBones, searchBones } from "@/lib/anatomy";
import { parseAnatomyTarget } from "@/lib/anatomyTarget";
import { defaultPreferences, markIntroSeen, PREFERENCE_KEY, readPreferences, shouldPlayIntro, type Preferences, type Section } from "@/lib/preferences";
import type { AssetStatus, CameraView, DisplayMode, Region, Side, ViewerCommand } from "@/lib/types";
import BoneInformation from "./BoneInformation";
import CinematicIntro from "./CinematicIntro";

const SkeletonViewer = dynamic(() => import("./SkeletonViewer"), {
  ssr: false,
  loading: () => <div className="viewer-loading">Initializing 3D engine…</div>,
});
const navigation = [
  { id: "explorer", title: "Anatomical explorer", icon: Box, number: "01" },
  { id: "skeleton", title: "Complete skeleton", icon: BoneIcon, number: "02" },
  { id: "catalog", title: "Bone information", icon: Database, number: "03" },
  { id: "relationships", title: "Anatomical relationships", icon: Link2, number: "04" },
] as const;
const sectionTitles: Record<Section, { title: string; text: string }> = {
  explorer: { title: "Anatomical explorer", text: "Explore the architecture of the human body." },
  skeleton: { title: "Complete human skeleton", text: "206 reference records. Transparent 3D coverage." },
  catalog: { title: "Bone information explorer", text: "A unified anatomical identity for every adult bone." },
  relationships: { title: "Anatomical relationships", text: "Understand each structure in its anatomical context." },
  settings: { title: "Workspace settings", text: "Your environment. Your research preferences." },
};
const views: { value: CameraView; label: string }[] = [
  { value: "anterior", label: "Anterior" }, { value: "posterior", label: "Posterior" },
  { value: "left", label: "Left lateral" }, { value: "right", label: "Right lateral" },
  { value: "superior", label: "Superior" }, { value: "inferior", label: "Inferior" }, { value: "oblique", label: "Oblique" },
];
const initialAsset: AssetStatus = { state: "loading", message: "Checking anatomical asset…", loadedBoneIds: [] };

export default function Explorer() {
  const [linkedTarget, setLinkedTarget] = useState(() => typeof window === "undefined" ? null : parseAnatomyTarget(window.location.search));
  const [preferences, setPreferences] = useState<Preferences>(() => {
    const saved = readPreferences(bones);
    return linkedTarget ? { ...saved, section: "explorer", selectedBoneId: linkedTarget.boneId, region: "All", side: "All" } : saved;
  });
  const [intro, setIntro] = useState(() => !linkedTarget && shouldPlayIntro(readPreferences(bones).playIntro));
  const [query, setQuery] = useState(linkedTarget?.boneId ?? "");
  const [mode, setMode] = useState<DisplayMode>(linkedTarget ? "connected" : "all");
  const [asset, setAsset] = useState<AssetStatus>(initialAsset);
  const [assetRevision, setAssetRevision] = useState(0);
  const [command, setCommand] = useState<ViewerCommand | null>(null);
  const [cameraView, setCameraView] = useState<CameraView>("anterior");
  const [mobileNav, setMobileNav] = useState(false);
  const [storageWarning, setStorageWarning] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const workspace = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const helpButton = useRef<HTMLButtonElement>(null);
  const closeHelp = useRef<HTMLButtonElement>(null);
  const selected = getBone(preferences.selectedBoneId ?? "");
  const related = useMemo(() => selected ? getRelatedBones(selected.id) : [], [selected]);
  const relatedIds = useMemo(() => related.map((bone) => bone.id), [related]);
  const regions = useMemo(() => Array.from(new Set(bones.map((bone) => bone.region))), []);
  const results = useMemo(() => searchBones(query, {
    region: preferences.region === "All" ? undefined : preferences.region,
    side: preferences.side === "All" ? undefined : preferences.side,
  }), [query, preferences.region, preferences.side]);
  const loaded = new Set(asset.loadedBoneIds);
  const ready = asset.state === "ready";
  const selectedLoaded = Boolean(ready && selected && loaded.has(selected.id));
  const title = sectionTitles[preferences.section];

  const update = useCallback((patch: Partial<Preferences>) => {
    setPreferences((previous) => ({ ...previous, ...patch }));
  }, []);
  useEffect(() => {
    try { localStorage.setItem(PREFERENCE_KEY, JSON.stringify(preferences)); }
    catch { queueMicrotask(() => setStorageWarning(true)); }
  }, [preferences]);
  useEffect(() => { if (helpOpen) closeHelp.current?.focus(); }, [helpOpen]);
  const finishIntro = useCallback(() => {
    markIntroSeen();
    setIntro(false);
    requestAnimationFrame(() => workspace.current?.focus());
  }, []);
  const onAssetStatus = useCallback((status: AssetStatus) => setAsset(status), []);
  const issue = (type: ViewerCommand["type"], view?: CameraView) => setCommand((previous) => ({ id: (previous?.id ?? 0) + 1, type, view }));
  function selectBone(id: string) {
    setLinkedTarget(null);
    update({ selectedBoneId: id });
    if (window.matchMedia("(max-width: 1020px)").matches) {
      requestAnimationFrame(() => document.getElementById("bone-information")?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      }));
    }
  }
  function navigate(section: Section) { update({ section }); setMobileNav(false); }
  function resetView() { setMode("all"); setCameraView("anterior"); issue("reset"); }
  function dismissHelp() { setHelpOpen(false); requestAnimationFrame(() => helpButton.current?.focus()); }

  return <>
    {intro && <CinematicIntro onFinish={finishIntro} />}
    <div className="application" inert={intro || helpOpen || undefined} ref={workspace} tabIndex={-1}>
      <a href="#workspace" className="skip-link">Skip to workspace</a>
      <header className="topbar"><div className="brand"><span className="brand-mark">V</span><span>VITRION<span className="brand-suffix">_01</span></span><span className="brand-divider" /><span className="brand-description">ANATOMICAL<br />RESEARCH SYSTEM</span></div><div className="topbar-right"><span className="environment-badge"><span className="status-dot ready" /> REFERENCE WORKSPACE</span><span className="version">v0.1 / FOUNDATION</span><button ref={helpButton} className="icon-button" aria-label="Open workspace guide" onClick={() => setHelpOpen(true)}><CircleHelp size={18} /></button><button className="mobile-menu icon-button" onClick={() => setMobileNav(!mobileNav)} aria-label="Toggle navigation" aria-expanded={mobileNav}><Menu size={20} /></button></div></header>
      <div className="application-body">
        <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}><div className="sidebar-label">WORKSPACE <span>01—04</span></div><nav aria-label="Main navigation">{navigation.map((item) => <button key={item.id} className={`nav-item ${preferences.section === item.id ? "selected" : ""}`} onClick={() => navigate(item.id)} aria-current={preferences.section === item.id ? "page" : undefined}><item.icon size={17} strokeWidth={1.5} /><span>{item.title}</span><span className="nav-number">{item.number}</span></button>)}</nav><div className="sidebar-divider" /><div className="sidebar-label">ANALYSIS <span>LOCAL RESEARCH</span></div><Link href="/cases?modality=XR" className="nav-item"><Activity size={16} /><span>X-ray findings</span><span className="nav-number">REVIEW</span></Link><Link href="/cases?modality=MR" className="nav-item"><Fingerprint size={16} /><span>MRI written reports</span><span className="nav-number">DRAFT</span></Link><Link href="/cases" className="nav-item"><Microscope size={16} /><span>Research cases &amp; exports</span><ArrowUpRight size={14} /></Link><p className="roadmap-note">Synthetic cases only.<br />No clinical deployment approval.</p><div className="sidebar-bottom"><div className="reference-card"><div><Layers3 size={16} /><span>ANATOMICAL CATALOG</span></div><strong>{bones.length}<small>adult bone records</small></strong><div className="catalog-counts"><span>80 axial</span><span>126 appendicular</span></div></div><button className={`nav-item ${preferences.section === "settings" ? "selected" : ""}`} onClick={() => navigate("settings")} aria-current={preferences.section === "settings" ? "page" : undefined}><Settings2 size={17} /><span>Settings</span><ChevronRight size={14} /></button><div className="sidebar-disclaimer"><ShieldCheck size={15} /><span>Research use only.<br />Not a diagnostic device.</span></div></div></aside>
        <main id="workspace" className="workspace">
          <div className="workspace-heading"><div><div className="breadcrumb">WORKSPACE <ChevronRight size={10} /> {preferences.section === "settings" ? "CONFIGURATION" : "ANATOMY"}</div><h1>{title.title}<span className="title-period">.</span></h1><p>{title.text}</p></div><span className="foundation-tag">PHASE 01 / 02</span></div>
          {storageWarning && <p className="warning-banner" role="status">Browser storage is unavailable. Preferences will last only for this visit.</p>}
          {linkedTarget && <aside className="warning-banner" role="status">Anatomy link: <strong>{selected?.name}</strong>{linkedTarget.assertion === "uncertain" ? " · POSSIBLE / UNCERTAIN finding—verify the report wording." : " · Review the source evidence before interpreting."} Whole-bone reference localization only. No patient-specific fracture geometry was inferred. Use Focus/Isolate, then manually place an approximate crack if supported by reviewed evidence. <Link href="/cases" style={{ textDecoration: "underline" }}>Return to cases</Link></aside>}
          <div className="workspace-columns"><div className="main-column">
            {preferences.section === "settings" ? <section className="settings-card"><div className="section-heading"><Settings2 size={17} /><h2>Environment &amp; preferences</h2></div><label className="toggle-row"><span><strong>Cinematic introduction</strong><small>Play once per browser session. Reduced-motion preferences take priority.</small></span><input type="checkbox" checked={preferences.playIntro} onChange={(event) => update({ playIntro: event.target.checked })} /></label><label className="toggle-row"><span><strong>Slow automatic rotation</strong><small>Rotate the licensed model while exploring.</small></span><input type="checkbox" checked={preferences.autoRotate} onChange={(event) => update({ autoRotate: event.target.checked })} /></label><div className="setting-description"><h3>Local preferences only</h3><p>The selected bone, section, filters, and preferences are stored in this browser. No medical data, accounts, or patient uploads are handled in this release.</p><button className="small-button" onClick={() => { setPreferences({ ...defaultPreferences, section: "settings" }); setQuery(""); resetView(); }}>Reset workspace preferences</button></div><div className="setting-description"><h3>Licensed anatomical asset</h3><p>Install a licensed, individually addressable GLB and manifest in <code>public/anatomy</code>. See the project asset integration documentation for coordinates, units, mappings, and validation requirements.</p><div className="asset-status-line"><span className={`status-dot ${ready ? "ready" : ""}`} /><span>{asset.message}</span></div><button className="small-button" onClick={() => setAssetRevision((value) => value + 1)}><RotateCcw size={13} /> Recheck installed asset</button></div><div className="setting-description"><h3>Scientific integrity</h3><p>206 catalog records do not imply 206 available 3D meshes. No mesh, dimensional measurement, clinical prediction, or confidence score is fabricated. General references require expert review before clinical application.</p></div></section> : <>
              <section className="viewer-card" aria-label="3D anatomical workspace"><div className="viewer-toolbar"><div className="viewer-label"><span className={`status-dot ${ready ? "ready" : ""}`} /><span>HUMAN SKELETON</span><span className="micro-label">/ ADULT</span></div><div className="viewer-coverage"><span>{asset.loadedBoneIds.length}</span> / {bones.length} meshes linked</div></div><div className="viewer-stage"><div className="viewer-corner top-left" /><div className="viewer-corner top-right" /><div className="viewer-corner bottom-left" /><div className="viewer-corner bottom-right" /><div className="orientation-label">{cameraView.toUpperCase()}<span>Y ↑ · Z ANTERIOR</span></div><SkeletonViewer bones={bones} selectedBoneId={preferences.selectedBoneId} relatedBoneIds={relatedIds} displayMode={mode} autoRotate={preferences.autoRotate} command={command} assetRevision={assetRevision} onSelect={selectBone} onStatus={onAssetStatus} /><div className="viewer-mode"><span className="crosshair-mark">+</span>{mode === "all" ? "FULL ANATOMICAL CONTEXT" : mode === "isolate" ? "ISOLATED STRUCTURE" : mode === "connected" ? "ARTICULATING STRUCTURES" : "REGIONAL CONTEXT"}</div><div className="zoom-tools"><button disabled={!ready} onClick={() => issue("zoomIn")} aria-label="Zoom in"><Plus size={17} /></button><button disabled={!ready} onClick={() => issue("zoomOut")} aria-label="Zoom out"><Minus size={17} /></button><span /><button disabled={!ready} onClick={resetView} aria-label="Reset camera and visibility"><RotateCcw size={16} /></button><button disabled={!selectedLoaded} onClick={() => issue("focus")} aria-label="Focus selected bone"><Focus size={17} /></button></div></div><div className="viewer-controls"><div className="camera-presets"><Move3D size={15} /><label className="sr-only" htmlFor="camera-view">Camera orientation</label><select id="camera-view" disabled={!ready} value={cameraView} onChange={(event) => { const view = event.target.value as CameraView; setCameraView(view); issue("view", view); }}>{views.map((view) => <option key={view.value} value={view.value}>{view.label}</option>)}</select><ChevronDown size={12} /></div><button className={preferences.autoRotate ? "rotation-toggle active" : "rotation-toggle"} disabled={!ready} aria-pressed={preferences.autoRotate} onClick={() => update({ autoRotate: !preferences.autoRotate })}><RotateCcw size={13} />Auto-rotate</button><span className="controls-separator" /><span className="control-hint">Drag to orbit · Scroll to zoom · Pinch on touch</span></div><div className="viewer-legend"><span><i className="legend-dot ivory" />Normal</span><span><i className="legend-dot hover" />Hover</span><span><i className="legend-dot selected" />Selected</span><span><i className="legend-dot related" />Connected</span><span className="legend-note">3D coverage is asset-verified</span></div>{!ready && asset.state !== "loading" && <div className="asset-action-bar"><span>{asset.state === "error" ? "3D rendering needs attention." : "A licensed anatomical model is required."}</span><button className="text-button" onClick={() => setAssetRevision((value) => value + 1)}><RotateCcw size={12} />Retry</button><button className="text-button" onClick={() => navigate("settings")}>Asset settings <ArrowUpRight size={12} /></button></div>}</section>
              {preferences.section === "skeleton" && <section className="coverage-card"><div><span className="eyebrow">REFERENCE ≠ RENDERED COVERAGE</span><h2>{asset.loadedBoneIds.length} of {bones.length} bones linked</h2><p>The standard adult count treats fused sacrum, coccyx, and each hip bone as single bones. Individual anatomical variation is not represented.</p></div><div className="coverage-meter" role="progressbar" aria-label="Loaded mesh coverage" aria-valuenow={asset.loadedBoneIds.length} aria-valuemin={0} aria-valuemax={206}><span style={{ width: `${asset.loadedBoneIds.length / 206 * 100}%` }} /></div></section>}
              {preferences.section === "relationships" && <section className="relationships-card"><div className="section-heading"><Link2 size={17} /><h2>{selected ? `${selected.name}: connections` : "Select a structure to trace its connections"}</h2></div>{selected ? <><div className="relationship-origin"><BoneIcon size={18} /><strong>{selected.name}</strong><code>{selected.id}</code></div><div className="relationship-branches">{related.length ? related.map((bone) => <button key={bone.id} onClick={() => selectBone(bone.id)}><span className="relationship-line" /><div><strong>{bone.name}</strong><span>{bone.region} · {bone.side}</span></div><ArrowUpRight size={16} /></button>) : <p className="muted-note">No articulations are curated for this record. This does not imply missing biological context.</p>}</div><p className="muted-note">Connections are curated anatomical articulations, not geometric nearest neighbors. Regional context and opposite-side relationships are kept separate.</p></> : <p className="muted-note">Choose a bone from the searchable catalog below. The same permanent IDs connect all anatomical views.</p>}</section>}
              <section className="catalog-panel"><div className="catalog-heading"><div className="section-heading"><Database size={17} /><h2>Reference catalog</h2><span className="count-pill">{bones.length}</span></div><span className="micro-label">PERMANENT ANATOMICAL IDs</span></div><div className="catalog-filters"><div className="search-field"><Search size={16} /><input ref={searchInput} aria-label="Search bones" placeholder="Search bones, regions, or anatomical IDs…" value={query} onChange={(event) => setQuery(event.target.value)} />{query && <button aria-label="Clear search" onClick={() => { setQuery(""); searchInput.current?.focus(); }}><X size={14} /></button>}</div><div className="filter-select"><SlidersHorizontal size={14} /><select aria-label="Filter anatomical region" value={preferences.region} onChange={(event) => update({ region: event.target.value as Region | "All" })}><option value="All">All regions</option>{regions.map((region) => <option key={region} value={region}>{region}</option>)}</select></div><div className="filter-select"><select aria-label="Filter laterality" value={preferences.side} onChange={(event) => update({ side: event.target.value as Side | "All" })}><option value="All">Both sides / midline</option><option>Left</option><option>Right</option><option>Midline</option></select></div></div><div className="catalog-results-header"><span role="status">{results.length} {results.length === 1 ? "structure" : "structures"}</span><button className="text-button" disabled={!query && preferences.region === "All" && preferences.side === "All"} onClick={() => { setQuery(""); update({ region: "All", side: "All" }); }}>Reset filters</button></div><div className={`bone-grid ${preferences.section === "catalog" ? "expanded" : ""}`}>{results.map((bone) => <button key={bone.id} className={`bone-card ${selected?.id === bone.id ? "selected" : ""}`} onClick={() => selectBone(bone.id)} aria-pressed={selected?.id === bone.id}><span className="bone-card-icon"><BoneIcon size={20} strokeWidth={1.2} /></span><span className="bone-card-text"><strong>{bone.name}</strong><span>{bone.region} · {bone.side}</span><code>{bone.id}</code></span><span className={`mesh-indicator ${loaded.has(bone.id) ? "linked" : ""}`} title={loaded.has(bone.id) ? "3D mesh linked" : "3D mesh unavailable"} aria-label={loaded.has(bone.id) ? "3D mesh linked" : "3D mesh unavailable"} /><ChevronRight size={14} /></button>)}</div>{!results.length && <div className="no-results"><Search size={24} /><h3>No matching structures</h3><p>Try a bone name, anatomical ID, or broader filters.</p></div>}</section>
            </>}
            {preferences.section === "settings" && <div className="settings-viewer"><SkeletonViewer bones={bones} selectedBoneId={preferences.selectedBoneId} relatedBoneIds={relatedIds} displayMode={mode} autoRotate={preferences.autoRotate} command={command} assetRevision={assetRevision} onSelect={selectBone} onStatus={onAssetStatus} /></div>}
            <footer className="workspace-footer"><span>VITRION_01 <span className="footer-slash">/</span> ANATOMICAL INTELLIGENCE FOUNDATION</span><span>Reference data · Not clinically validated</span></footer>
          </div><BoneInformation bone={selected} loaded={selectedLoaded} mode={mode} onSelect={selectBone} onMode={setMode} onFocus={() => issue("focus")} onClear={() => { update({ selectedBoneId: null }); setMode("all"); }} /></div>
        </main>
      </div>
    </div>
    {helpOpen && <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) dismissHelp(); }}><section className="guide-modal" role="dialog" aria-modal="true" aria-labelledby="guide-title" onKeyDown={(event) => { if (event.key === "Escape") dismissHelp(); if (event.key === "Tab") { const elements = event.currentTarget.querySelectorAll<HTMLElement>('button, a[href]'); const first = elements[0]; const last = elements[elements.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } } }}><button ref={closeHelp} className="icon-button modal-close" aria-label="Close guide" onClick={dismissHelp}><X size={20} /></button><span className="eyebrow">WORKSPACE GUIDE</span><h2 id="guide-title">Anatomy, with context.</h2><div className="guide-step"><Search size={19} /><div><h3>Find a structure</h3><p>Search the 206-record adult bone catalog by name, ID, or region. Filter by laterality, then select a record.</p></div></div><div className="guide-step"><Crosshair size={19} /><div><h3>Explore a licensed model</h3><p>Once an asset is installed, click a mesh to select it. Drag to orbit, use the wheel or pinch to zoom, and use camera presets, isolation, or connected-bone views.</p></div></div><div className="guide-step"><ShieldCheck size={19} /><div><h3>Know the boundaries</h3><p>This release covers the anatomical foundation only. No licensed 3D asset is bundled. X-ray analysis, MRI interpretation, patient cases, and diagnostic functions are not enabled.</p></div></div><h3 className="guide-sources-title">Anatomical reference sources</h3><div className="source-list">{sources.map((source) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer">{source.title}<ArrowUpRight size={12} /></a>)}</div><button className="primary-button guide-done" onClick={dismissHelp}>Return to workspace <ArrowRight size={14} /></button></section></div>}
  </>;
}
