"use client";

import dynamic from "next/dynamic";
import "./dicom.css";

const DicomWorkspace = dynamic(() => import("@/components/DicomWorkspace"), {
  ssr: false,
  loading: () => <main className="dicom-workspace">Loading local DICOM viewer…</main>,
});

export default function DicomPage() {
  return <DicomWorkspace />;
}
