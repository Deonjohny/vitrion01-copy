import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { diagnosticUploads, MAX_DIAGNOSTIC_UPLOAD_BYTES, validateDiagnosticUpload } from "../src/lib/uploadPolicy";

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]);
const pdf = new TextEncoder().encode("%PDF-1.7\n");
const jpeg = new Uint8Array([255, 216, 255, 224]);
function file(bytes: Uint8Array, name: string, type: string) { return new File([bytes as Uint8Array<ArrayBuffer>], name, { type }); }
describe("two-format diagnostic upload policy", () => {
  it("keeps two separate clearly named PNG/PDF choices", async () => {
    expect(Object.keys(diagnosticUploads)).toEqual(["xray", "mri"]);
    expect(diagnosticUploads.xray.label).toBe("Upload PNG X-ray Image");
    expect(diagnosticUploads.mri.label).toBe("Upload MRI Report (PDF)");
    await expect(validateDiagnosticUpload(file(png, "Xray.PNG", "image/png"), "xray")).resolves.toBeUndefined();
    await expect(validateDiagnosticUpload(file(pdf, "Report.PDF", "application/pdf"), "mri")).resolves.toBeUndefined();
  });
  it.each(["jpg", "jpeg", "dcm", "dicom", "docx", "pdf", "gif", "webp"])("rejects %s for an X-ray even if claimed PNG MIME", async (extension) => {
    await expect(validateDiagnosticUpload(file(png, `image.${extension}`, "image/png"), "xray")).rejects.toThrow("Only PNG");
  });
  it.each(["jpg", "jpeg", "dcm", "png", "docx", "txt"])("rejects %s for an MRI report even if claimed PDF MIME", async (extension) => {
    await expect(validateDiagnosticUpload(file(pdf, `report.${extension}`, "application/pdf"), "mri")).rejects.toThrow("Only PDF");
  });
  it("rejects renamed JPEG/DOCX/image content, mismatched and blank MIME", async () => {
    await expect(validateDiagnosticUpload(file(jpeg, "renamed.png", "image/png"), "xray")).rejects.toThrow("not a PNG");
    await expect(validateDiagnosticUpload(file(new TextEncoder().encode("PK\x03\x04"), "renamed.pdf", "application/pdf"), "mri")).rejects.toThrow("not a PDF");
    await expect(validateDiagnosticUpload(file(png, "renamed.pdf", "application/pdf"), "mri")).rejects.toThrow("not a PDF");
    for (const mime of ["image/jpeg", "application/octet-stream", ""]) {
      await expect(validateDiagnosticUpload(file(png, "image.png", mime), "xray")).rejects.toThrow("Only PNG");
    }
    await expect(validateDiagnosticUpload(file(pdf, "report.pdf.exe", "application/pdf"), "mri")).rejects.toThrow("Only PDF");
  });
  it("preserves the nonempty 10MiB limit", async () => {
    await expect(validateDiagnosticUpload(file(new Uint8Array(), "empty.png", "image/png"), "xray")).rejects.toThrow("nonempty");
    await expect(validateDiagnosticUpload(file(new Uint8Array(MAX_DIAGNOSTIC_UPLOAD_BYTES + 1), "large.pdf", "application/pdf"), "mri")).rejects.toThrow("10 MiB");
  });
  it("disables legacy, DICOM, pasted-text and standalone finding inputs without changing styles", () => {
    const read = (name: string) => readFileSync(new URL(`../src/components/${name}`, import.meta.url), "utf8");
    expect(read("DicomWorkspace.tsx")).toContain("const DICOM_UPLOADS_ENABLED = false");
    expect(read("DicomWorkspace.tsx")).toContain("if (!DICOM_UPLOADS_ENABLED) return;");
    expect(read("ModelWorkbench.tsx")).toContain("const LEGACY_UPLOADS_ENABLED = false");
    expect(read("ReportWorkbench.tsx")).not.toContain("/mri/report-text");
    expect(read("ReportWorkbench.tsx")).not.toContain("Analyze saved report text");
    expect(read("CaseWorkspace.tsx")).toContain('value={draft.reportText} readOnly');
    expect(read("CaseWorkspace.tsx")).toContain('<button type="button" disabled onClick={addFinding}>');
  });
});
