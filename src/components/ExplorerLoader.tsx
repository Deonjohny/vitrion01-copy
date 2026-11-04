"use client";

import dynamic from "next/dynamic";

const Explorer = dynamic(() => import("./Explorer"), {
  ssr: false,
  loading: () => <main className="boot-screen"><span className="brand-mark">V</span><p>VITRION_01</p><span>Initializing anatomical workspace…</span></main>,
});

export default function ExplorerLoader() {
  return <><Explorer /><noscript>This interactive anatomical explorer requires JavaScript.</noscript></>;
}
