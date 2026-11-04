import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAuditVerification, parseCase } from "../src/lib/clinical";
import { fhirDiagnosticReport } from "../src/utils/fhirDiagnosticReport";

const enabled = process.env.CLINICAL_INTEGRATION === "1";
describe.skipIf(!enabled)("synthetic clinical integration through the deployed frontend", () => {
  it("enforces authorization and exports a linked FHIR report after two distinct reviews", async () => {
    const tokenDirectory = process.env.CLINICAL_TOKEN_DIRECTORY;
    if (!tokenDirectory) throw new Error("CLINICAL_TOKEN_DIRECTORY must contain locally issued short-lived synthetic test tokens.");
    const base = process.env.CLINICAL_INTEGRATION_URL ?? "http://127.0.0.1:3001/clinical-api";
    const parsed = new URL(base);
    if (parsed.hostname !== "127.0.0.1" || parsed.protocol !== "http:") throw new Error("Integration tests are restricted to loopback synthetic deployments.");
    const token = (name: string) => readFileSync(join(tokenDirectory, `${name}-token.txt`), "utf8").trim();
    async function request(path: string, accessToken: string, method = "GET", body?: unknown) {
      return fetch(`${base}${path}`, { method, signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${accessToken}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    }
    const r1 = token("r1"), r2 = token("r2"), researcher = token("research"), compliance = token("compliance");
    expect((await fetch(`${base}/cases`)).status).toBe(401);
    expect((await request("/cases", compliance)).status).toBe(403);
    const input = { patientPseudoId: "SYNTHETIC-E2E", dicomSeriesInstanceUid: null, reportText: "Synthetic integration report; no diagnosis.", modality: "XR", boneIds: ["FEMUR_LEFT"], findings: [{ id: crypto.randomUUID(), boneId: "FEMUR_LEFT", fmaId: null, label: "Synthetic test finding", confidence: null, boundingBox: null, displacementMm: null, aoOtaCode: null, radlexId: null }] };
    expect((await request("/cases", researcher, "POST", input)).status).toBe(403);
    const createdResponse = await request("/cases", r1, "POST", input);
    expect(createdResponse.ok).toBe(true);
    const created = parseCase(await createdResponse.json());
    const path = `/cases/${created.id}`;
    const firstResponse = await request(`${path}/sign`, r1, "POST", { expectedRevision: created.revision });
    expect(firstResponse.ok).toBe(true);
    expect(parseCase(await firstResponse.json()).state).toBe("PRELIMINARY");
    expect((await request(`${path}/sign`, r1, "POST", { expectedRevision: created.revision })).status).toBe(409);
    const verifiedResponse = await request(`${path}/sign`, r2, "POST", { expectedRevision: created.revision });
    expect(verifiedResponse.ok).toBe(true);
    const verified = parseCase(await verifiedResponse.json());
    expect(verified.state).toBe("VERIFIED");
    const exportResponse = await request(`${path}/export`, researcher);
    expect(exportResponse.ok).toBe(true);
    const bundle = fhirDiagnosticReport(parseCase(await exportResponse.json()), { identifierSystem: "http://localhost/synthetic", reviewerIdentifierSystem: "http://localhost/reviewers" });
    const report = bundle.entry.find((e) => e.resource.resourceType === "DiagnosticReport")?.resource;
    expect(report?.resourceType === "DiagnosticReport" && report.status).toBe("final");
    const audit = await request("/audit/verify", compliance);
    expect(audit.ok).toBe(true);
    expect(parseAuditVerification(await audit.json()).entries).toBeGreaterThan(0);
  }, 30000);
});
