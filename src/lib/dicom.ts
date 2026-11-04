import { parseDicom } from "dicom-parser";

export const MAX_FILES = 32;
export const MAX_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
export const SUPPORTED_TRANSFER_SYNTAXES = ["1.2.840.10008.1.2", "1.2.840.10008.1.2.1"] as const;

export function validateDicomFiles(files: readonly Pick<File, "size" | "name">[]): void {
  if (!files.length || files.length > MAX_FILES) throw new Error(`Select 1–${MAX_FILES} synthetic DICOM files.`);
  let total = 0;
  for (const file of files) {
    if (!/\.(dcm|dicom)$/i.test(file.name)) throw new Error("Only .dcm or .dicom files are accepted.");
    if (!Number.isSafeInteger(file.size) || file.size < 132 || file.size > MAX_FILE_BYTES) throw new Error("Each DICOM must be 132 bytes–16 MiB.");
    total += file.size;
  }
  if (total > MAX_TOTAL_BYTES) throw new Error("The selection exceeds 64 MiB.");
}

export function validateTransferSyntax(uid: string | undefined): void {
  if (!SUPPORTED_TRANSFER_SYNTAXES.some((supported) => supported === uid)) {
    throw new Error("Only uncompressed implicit/explicit VR little-endian DICOM is supported; compressed and big-endian images are not supported.");
  }
}

export type DecodedDicom = { rows: number; columns: number; pixels: Float32Array; invert: boolean; width: number; level: number };

export function inspectDicom(bytes: Uint8Array): DecodedDicom {
  if (bytes.length < 132 || String.fromCharCode(...bytes.subarray(128, 132)) !== "DICM") throw new Error("A DICOM Part 10 file with a DICM header is required.");
  let data;
  try { data = parseDicom(bytes, { untilTag: "x7fe00010" }); }
  catch { throw new Error("The DICOM header could not be decoded."); }
  validateTransferSyntax(data.string("x00020010"));
  const rows = data.uint16("x00280010") ?? 0;
  const columns = data.uint16("x00280011") ?? 0;
  const bits = data.uint16("x00280100");
  const photo = data.string("x00280004")?.trim();
  const frames = Number(data.string("x00280008") || "1");
  if (!rows || !columns || rows > 2048 || columns > 2048 || ![8, 16].includes(bits ?? 0) || data.uint16("x00280002") !== 1 || !["MONOCHROME1", "MONOCHROME2"].includes(photo ?? "") || frames !== 1) {
    throw new Error("Supported images: single-frame 8/16-bit monochrome, up to 2048 × 2048 pixels. Select multiple files for a stack.");
  }
  const pixel = data.elements.x7fe00010;
  const required = rows * columns * (bits! / 8);
  if (!pixel || pixel.length < required || pixel.dataOffset + required > bytes.length) throw new Error("DICOM pixel data is missing or truncated.");
  const stored = data.uint16("x00280101") ?? bits!;
  const high = data.uint16("x00280102") ?? stored - 1;
  const signed = data.uint16("x00280103") ?? 0;
  if (stored < 1 || stored > bits! || high !== stored - 1 || signed > 1) throw new Error("Unsupported DICOM pixel bit layout.");
  const slope = Number(data.string("x00281053") || "1");
  const intercept = Number(data.string("x00281052") || "0");
  if (!Number.isFinite(slope) || !Number.isFinite(intercept) || slope === 0) throw new Error("Invalid DICOM rescale values.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pixels = new Float32Array(rows * columns);
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < pixels.length; i++) {
    let value = bits === 8 ? view.getUint8(pixel.dataOffset + i) : view.getUint16(pixel.dataOffset + i * 2, true);
    value &= (2 ** stored) - 1;
    if (signed && value >= 2 ** (stored - 1)) value -= 2 ** stored;
    value = value * slope + intercept;
    if (!Number.isFinite(value) || Math.abs(value) > 1e20) throw new Error("Invalid DICOM pixel values.");
    pixels[i] = value;
    min = Math.min(min, value); max = Math.max(max, value);
  }
  const rawWidth = Number(data.string("x00281051")?.split("\\")[0]);
  const rawLevel = Number(data.string("x00281050")?.split("\\")[0]);
  return { rows, columns, pixels, invert: photo === "MONOCHROME1", width: Number.isFinite(rawWidth) && rawWidth >= 1 ? rawWidth : Math.max(1, max - min + 1), level: Number.isFinite(rawLevel) ? rawLevel : (max + min) / 2 };
}

export function renderGrayscale(image: DecodedDicom, width: number, level: number): Uint8ClampedArray {
  if (!Number.isFinite(width) || width < 1 || !Number.isFinite(level)) throw new Error("Invalid window settings.");
  const rgba = new Uint8ClampedArray(image.pixels.length * 4);
  for (let i = 0; i < image.pixels.length; i++) {
    const value = image.pixels[i];
    let gray = width === 1 ? (value > level - 0.5 ? 255 : 0) : Math.max(0, Math.min(255, ((value - (level - 0.5)) / (width - 1) + 0.5) * 255));
    if (image.invert) gray = 255 - gray;
    rgba.set([gray, gray, gray, 255], i * 4);
  }
  return rgba;
}
