import type { Bundle as R4Bundle } from "fhir/r4";
import { isUuid, parseCase, type CaseRecord, type Finding } from "../lib/clinical";

interface Coding { system: string; code: string; display?: string }
interface Concept { coding?: Coding[]; text?: string }
interface Reference { reference: string }
interface Quantity { value: number; unit: string; system: "http://unitsofmeasure.org"; code: string }
export interface FhirObservation {
  resourceType: "Observation";
  id: string;
  status: "preliminary" | "final" | "amended";
  category: Concept[];
  code: Concept;
  subject: Reference;
  valueString: string;
  bodySite?: Concept;
  component?: { code: Concept; valueQuantity?: Quantity; valueString?: string }[];
}
export interface FhirDiagnosticReport {
  resourceType: "DiagnosticReport";
  id: string;
  status: "preliminary" | "final" | "amended";
  category: Concept[];
  code: Concept;
  subject: Reference;
  issued: string;
  result: Reference[];
  conclusion: string;
  resultsInterpreter?: Reference[];
}
interface Patient { resourceType: "Patient"; id: string; identifier: { system: string; value: string }[] }
interface Practitioner { resourceType: "Practitioner"; id: string; identifier: { system: string; value: string }[] }
interface Provenance {
  resourceType: "Provenance";
  id: string;
  target: Reference[];
  recorded: string;
  agent: { type: Concept; who: Reference }[];
}
export interface FhirBundle extends R4Bundle {
  resourceType: "Bundle";
  id: string;
  type: "collection";
  timestamp: string;
  entry: { fullUrl: string; resource: Patient | Practitioner | FhirDiagnosticReport | FhirObservation | Provenance }[];
}
export interface FhirOptions {
  identifierSystem: string;
  reviewerIdentifierSystem: string;
  idFactory?: () => string;
}
const category: Concept = { coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "imaging", display: "Imaging" }] };
function bodySite(finding: Finding): Concept | undefined {
  if (finding.fmaId !== null && !/^FMA:?\d+$/.test(finding.fmaId)) throw new Error("FMA identifiers must use verified FMA numeric identifiers.");
  if (!finding.fmaId && !finding.boneId) return undefined;
  return {
    ...(finding.fmaId ? { coding: [{ system: "http://purl.org/sig/ont/fma", code: finding.fmaId.replace(":", "") }] } : {}),
    ...(finding.boneId ? { text: finding.boneId } : {}),
  };
}
/** Produces an R4 collection, not a signed report or a claim of clinical validation. */
export function fhirDiagnosticReport(input: CaseRecord, options: FhirOptions): FhirBundle {
  const record = parseCase(input);
  for (const system of [options.identifierSystem, options.reviewerIdentifierSystem]) {
    if (!/^https?:\/\/[^\s]+$/.test(system)) throw new Error("Identifier systems must be organization-owned HTTP(S) URIs.");
  }
  const currentSignatures = record.signatures.filter((s) => s.revision === record.revision);
  if (record.state !== "PRELIMINARY" && new Set(currentSignatures.map((s) => s.reviewerId)).size < 2) {
    throw new Error("A final or amended export requires two distinct current-revision reviewers.");
  }
  if (record.state !== "PRELIMINARY" && record.findings.length === 0) throw new Error("Reviewed reports require findings.");
  if (new Set(record.findings.map((f) => f.id)).size !== record.findings.length) throw new Error("Finding identifiers must be unique.");
  const reserved = new Set([record.id, ...record.findings.map((f) => f.id)]);
  if (reserved.size !== record.findings.length + 1) throw new Error("Report and finding identifiers must be distinct.");
  const nextId = () => {
    const id = (options.idFactory ?? (() => crypto.randomUUID()))();
    if (!isUuid(id) || reserved.has(id)) throw new Error("Resource identifiers must be unique UUIDs.");
    reserved.add(id); return id;
  };
  const patientId = nextId();
  const patientRef = { reference: `urn:uuid:${patientId}` };
  const status = record.state === "PRELIMINARY" ? "preliminary" : record.state === "AMENDED" ? "amended" : "final";
  const entry: FhirBundle["entry"] = [{
    fullUrl: patientRef.reference,
    resource: { resourceType: "Patient", id: patientId, identifier: [{ system: options.identifierSystem, value: record.patientPseudoId }] },
  }];
  for (const finding of record.findings) {
    if (finding.radlexId !== null && !/^RID\d+$/.test(finding.radlexId)) throw new Error("Invalid RadLex identifier.");
    const component: NonNullable<FhirObservation["component"]> = [];
    if (finding.confidence !== null) component.push({ code: { text: "Model confidence (not diagnostic certainty)" }, valueQuantity: { value: finding.confidence, unit: "1", system: "http://unitsofmeasure.org", code: "1" } });
    if (finding.displacementMm !== null) component.push({ code: { text: "Calibrated displacement" }, valueQuantity: { value: finding.displacementMm, unit: "mm", system: "http://unitsofmeasure.org", code: "mm" } });
    if (finding.aoOtaCode) component.push({ code: { text: "AO/OTA classification supplied by reviewer" }, valueString: finding.aoOtaCode });
    if (finding.boundingBox) component.push({ code: { text: "Normalized bounding box [ymin,xmin,ymax,xmax]" }, valueString: JSON.stringify(finding.boundingBox) });
    if (finding.reportEvidence) component.push({ code: { text: "Reviewed written-report evidence (rule-based draft; not clinically validated)" }, valueString: JSON.stringify(finding.reportEvidence) });
    if (finding.imageEvidence) component.push({ code: { text: "Experimental image detector provenance; anatomy assigned by reviewer" }, valueString: JSON.stringify(finding.imageEvidence) });
    if (finding.manualImageEvidence) component.push({ code: { text: "Reviewer-drawn source image trace; not model-generated segmentation" }, valueString: JSON.stringify(finding.manualImageEvidence) });
    const site = bodySite(finding);
    entry.push({ fullUrl: `urn:uuid:${finding.id}`, resource: {
      resourceType: "Observation", id: finding.id, status, category: [category],
      code: { text: finding.label, ...(finding.radlexId ? { coding: [{ system: "http://radlex.org", code: finding.radlexId }] } : {}) },
      subject: patientRef, valueString: finding.label,
      ...(site ? { bodySite: site } : {}), ...(component.length ? { component } : {}),
    } });
  }
  const interpreters: Reference[] = [];
  for (const reviewerId of new Set(currentSignatures.map((s) => s.reviewerId))) {
    const id = nextId();
    interpreters.push({ reference: `urn:uuid:${id}` });
    entry.push({ fullUrl: `urn:uuid:${id}`, resource: { resourceType: "Practitioner", id, identifier: [{ system: options.reviewerIdentifierSystem, value: reviewerId }] } });
  }
  entry.push({ fullUrl: `urn:uuid:${record.id}`, resource: {
    resourceType: "DiagnosticReport", id: record.id, status,
    category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0074", code: "RAD", display: "Radiology" }] }],
    code: { coding: [{ system: "http://loinc.org", code: "18748-4", display: "Diagnostic imaging study" }] },
    subject: patientRef, issued: record.updatedAt,
    result: record.findings.map((f) => ({ reference: `urn:uuid:${f.id}` })), conclusion: record.reportText,
    ...(interpreters.length ? { resultsInterpreter: interpreters } : {}),
  } });
  for (const signature of currentSignatures) {
    const id = nextId();
    const reviewerIndex = [...new Set(currentSignatures.map((s) => s.reviewerId))].indexOf(signature.reviewerId);
    entry.push({ fullUrl: `urn:uuid:${id}`, resource: {
      resourceType: "Provenance", id, target: [{ reference: `urn:uuid:${record.id}` }], recorded: signature.signedAt,
      agent: [{ type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/provenance-participant-type", code: "verifier" }] }, who: interpreters[reviewerIndex] }],
    } });
  }
  return { resourceType: "Bundle", id: nextId(), type: "collection", timestamp: record.updatedAt, entry };
}
