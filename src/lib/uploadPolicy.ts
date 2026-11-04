export type DiagnosticUploadKind = "xray" | "mri";
export const MAX_DIAGNOSTIC_UPLOAD_BYTES = 10 * 1024 * 1024;
export const diagnosticUploads = {
  xray: { label: "Upload PNG X-ray Image", accept: ".png,image/png", extension: ".png", mime: "image/png", signature: [137, 80, 78, 71, 13, 10, 26, 10] },
  mri: { label: "Upload MRI Report (PDF)", accept: ".pdf,application/pdf", extension: ".pdf", mime: "application/pdf", signature: [37, 80, 68, 70, 45] },
} as const;

export async function validateDiagnosticUpload(file: File, kind: DiagnosticUploadKind): Promise<void> {
  const policy = diagnosticUploads[kind];
  if (!file.name.toLowerCase().endsWith(policy.extension) || file.type.toLowerCase() !== policy.mime) {
    throw new Error(kind === "xray" ? "Only PNG X-ray images are accepted." : "Only PDF MRI reports are accepted.");
  }
  if (file.size <= 0 || file.size > MAX_DIAGNOSTIC_UPLOAD_BYTES) throw new Error(`Choose a nonempty ${kind === "xray" ? "PNG" : "PDF"} no larger than 10 MiB.`);
  const header = new Uint8Array(await file.slice(0, policy.signature.length).arrayBuffer());
  if (header.length !== policy.signature.length || !policy.signature.every((value, index) => header[index] === value)) {
    throw new Error(kind === "xray" ? "The selected file is not a PNG image. Renaming another format is not supported." : "The selected file is not a PDF document. Renaming another format is not supported.");
  }
}
