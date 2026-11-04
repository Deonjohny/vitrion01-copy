import { describe, expect, it } from "vitest";
import { inspectDicom, renderGrayscale, validateDicomFiles, validateTransferSyntax, MAX_FILE_BYTES, MAX_TOTAL_BYTES } from "../src/lib/dicom";

// Synthetic 2 x 2 ramp, no patient tags or clinical image content.
function fixture(implicit = false, signed = false): Uint8Array {
  const chunks: Buffer[] = [Buffer.alloc(128), Buffer.from("DICM")];
  function tag(group: number, element: number, vr: string, value: Buffer, explicit = true) {
    if (value.length % 2) value = Buffer.concat([value, Buffer.from([vr === "UI" ? 0 : 32])]);
    const long = ["OW", "OB"].includes(vr);
    const header = Buffer.alloc(explicit ? (long ? 12 : 8) : 8);
    header.writeUInt16LE(group, 0); header.writeUInt16LE(element, 2);
    if (explicit) { header.write(vr, 4); if (long) header.writeUInt32LE(value.length, 8); else header.writeUInt16LE(value.length, 6); }
    else header.writeUInt32LE(value.length, 4);
    chunks.push(header, value);
  }
  tag(2, 0x10, "UI", Buffer.from(implicit ? "1.2.840.10008.1.2" : "1.2.840.10008.1.2.1"));
  const us = (element: number, n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); tag(0x28, element, "US", b, !implicit); };
  us(2, 1); tag(0x28, 4, "CS", Buffer.from("MONOCHROME2"), !implicit);
  us(0x10, 2); us(0x11, 2); us(0x100, 16); us(0x101, 12); us(0x102, 11); us(0x103, signed ? 1 : 0);
  const pixels = Buffer.alloc(8); [0, 1024, 2048, 4095].forEach((value, i) => pixels.writeUInt16LE(value, i * 2));
  tag(0x7fe0, 0x10, "OW", pixels, !implicit);
  return new Uint8Array(Buffer.concat(chunks));
}

describe("synthetic DICOM safety limits", () => {
  it("accepts DICOM filenames without using names as patient metadata", () => expect(() => validateDicomFiles([{ name: "ramp.DCM", size: 1024 }])).not.toThrow());
  it.each([[], [{ name: "image.png", size: 1024 }], [{ name: "x.dcm", size: 0 }], [{ name: "x.dcm", size: MAX_FILE_BYTES + 1 }], Array.from({ length: 33 }, () => ({ name: "x.dcm", size: 132 })), Array.from({ length: 5 }, () => ({ name: "x.dcm", size: MAX_TOTAL_BYTES / 4 }))].map((files) => ({ files })))("rejects invalid selections", ({ files }) => expect(() => validateDicomFiles(files)).toThrow());
  it.each(["1.2.840.10008.1.2", "1.2.840.10008.1.2.1"])("accepts %s", (uid) => expect(() => validateTransferSyntax(uid)).not.toThrow());
  it.each([undefined, "1.2.840.10008.1.2.2", "1.2.840.10008.1.2.4.50"])("rejects unsupported syntax %s", (uid) => expect(() => validateTransferSyntax(uid)).toThrow());
});

describe("real synthetic pixel decoding", () => {
  it.each([false, true])("decodes little-endian pixels (implicit=%s)", (implicit) => {
    const image = inspectDicom(fixture(implicit));
    expect([image.rows, image.columns]).toEqual([2, 2]);
    expect(Array.from(image.pixels)).toEqual([0, 1024, 2048, 4095]);
    const rgba = renderGrayscale(image, image.width, image.level);
    expect(rgba[0]).toBe(0); expect(rgba[12]).toBe(255); expect(rgba[3]).toBe(255);
  });
  it("sign extends stored 12-bit samples", () => expect(Array.from(inspectDicom(fixture(false, true)).pixels)).toEqual([0, 1024, -2048, -1]));
  it("rejects missing Part 10 and truncated pixels", () => {
    expect(() => inspectDicom(new Uint8Array(150))).toThrow();
    expect(() => inspectDicom(fixture().subarray(0, fixture().length - 2))).toThrow();
  });
  it("inverts MONOCHROME1 and handles width 1", () => {
    const image = inspectDicom(fixture());
    expect(renderGrayscale({ ...image, invert: true }, image.width, image.level)[0]).toBe(255);
    expect(renderGrayscale(image, 1, 1000)[4]).toBe(255);
    expect(() => renderGrayscale(image, 0, 0)).toThrow();
  });
});
