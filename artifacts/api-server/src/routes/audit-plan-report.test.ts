import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDateFormat, setDateFormatResolver } from "@workspace/spreadsheet-dates";
import { SQL, getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
const mocks = vi.hoisted(() => ({ select: vi.fn(), render: vi.fn(), signature: vi.fn() }));
vi.mock("@workspace/db", async original => ({
  ...await original<Record<string, unknown>>(), db: { select: mocks.select },
}));
vi.mock("../lib/audit-plan-pdf", () => ({ renderAuditPlanPdf: mocks.render }));
vi.mock("../lib/audit-plan-signatures", () => ({ readAuditPlanSignature: mocks.signature }));
import router from "./audit";

const id = "11111111-1111-4111-8111-111111111111";
const lead = "22222222-2222-4222-8222-222222222222";
const creator = "33333333-3333-4333-8333-333333333333";
const role = "44444444-4444-4444-8444-444444444444";
const org = "55555555-5555-4555-8555-555555555555";
const metadata = {
  leadAuditorId: lead, auditeeRoleIds: [role], planNumber: "PLAN-001",
  startDateTimeRemark: "Saved start", endDateTimeRemark: "Saved end",
  openingMeetingDateTimeRemark: "Saved opening\nSecond line", closingMeetingDateTimeRemark: "",
  openingMeetingDateTime: "2026-10-12T09:15+14:00",
  activities: [{ section: "saved_activity", remarks: "Saved activity remark", roleIds: [role] }],
};
const savedPlan = { id, projectId: id, auditScheduleId: id, status: JSON.stringify(metadata),
  teamMemberIds: [lead], createdAt: "2026-10-01T00:00Z" };
const savedProject = { id, name: "Saved project", customFields: { contractNumber: "CON-1", contractValue: 0 } };
const previousFormat = getDateFormat();
beforeAll(() => setDateFormatResolver(() => "DD-MM-YYYY"));
afterAll(() => setDateFormatResolver(() => previousFormat));
let conditions: SQL[], tables: string[];
function selectResult(rows: unknown[]) {
  const query: any = {
    from: (table: any) => { tables.push(getTableName(table)); return query; },
    where: (condition: SQL) => { conditions.push(condition); return query; },
    innerJoin: () => query, orderBy: () => query, limit: () => query,
    then: (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject),
  };
  return query;
}
async function download() {
  // Exercise the actual report handler, independently of unrelated router RBAC.
  const layer = (router as any).stack.find((entry: any) => entry.route?.path === "/plans/:id/report");
  const req = { params: { id }, currentUser: { id: lead, organizationId: org }, get: () => "UTC" };
  const res = { setHeader: vi.fn(), send: vi.fn() };
  await new Promise<void>((resolve, reject) => {
    res.send.mockImplementation(() => resolve());
    layer.route.stack[0].handle(req, res, reject);
  });
  return res;
}
function queueDownload(project: unknown = savedProject, projectId = id) {
  for (const rows of [
    [{ ...savedPlan, projectId }],
    [{ id, status: JSON.stringify({ auditNumber: "AUD-1", qaqcClauses: "ISO 9001" }) }],
    [project],
    [{ actorId: creator }],
    [{ id: lead, name: "Selected lead", signaturePath: "lead-signature" },
      { id: creator, name: "Original creator", signaturePath: null }],
    [{ id: role, name: "Saved auditee role" }],
    [{ value: "saved_activity", label: "Saved Activity Label" }],
  ]) mocks.select.mockReturnValueOnce(selectResult(rows));
}
beforeEach(() => {
  vi.clearAllMocks();
  conditions = []; tables = [];
  queueDownload();
  mocks.signature.mockImplementation(async path => path ? new Uint8Array([1, 2, 3]) : undefined);
  mocks.render.mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
});
describe("Audit Plan report assembly", () => {
  it("downloads nested saved Additional Data — 2 through the real renderer without leaking between projects", async () => {
    const { renderAuditPlanPdf } = await vi.importActual<typeof import("../lib/audit-plan-pdf")>("../lib/audit-plan-pdf");
    mocks.render.mockImplementation(renderAuditPlanPdf);
    mocks.signature.mockResolvedValue(undefined);
    mocks.select.mockReset();
    const dir = await mkdtemp(join(tmpdir(), "plan-project-download-"));
    const sources = [
      { id, name: "North Project", customFields: { qmsAdditionalData: {
        contractProjectNumber: "NORTH-CONTRACT", client: "North Client", contractor: "North Contractor",
        tcc: "TCC after completion", pac: "2027-03 tentative", fac: "Not yet agreed", contractSigned: "2026-01-23",
        name: "UNRELATED CONTACT", contractPeriod: "UNRELATED PERIOD",
      } } },
      { id: creator, name: "South Project", customFields: {
        contractNumber: "STALE CONTRACT", mainContractor: "STALE CONTRACTOR", client: "Legacy Client",
        consultant: "Legacy Consultant", pmName: "Legacy Manager", contractValue: 0, ptsNo: 0,
        contractSignedDate: "Legacy signed text", qmsAdditionalData: { contractProjectNumber: null, contractor: " " },
      } },
    ];
    try {
      for (const [index, project] of sources.entries()) {
        queueDownload(project, project.id);
        const res = await download();
        const bytes = res.send.mock.calls[0][0];
        const file = join(dir, `plan-${index}.pdf`);
        await writeFile(file, bytes);
        if (index === 0) await writeFile("/tmp/audit-plan-nested-project-verification.pdf", bytes);
        const text = execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" }).replace(/\s+/g, " ");
        expect(text).toContain(project.name);
        expect(text).toContain("Saved Activity Label");
        expect(text).toContain("Selected lead");
        expect(text).toContain("Original creator");
        if (index === 0) {
          for (const value of ["NORTH-CONTRACT", "North Client", "North Contractor", "TCC after completion",
            "2027-03 tentative", "Not yet agreed", "23-01-2026"]) expect(text).toContain(value);
          for (const label of ["Consultant", "Project Manager", "Contract Value", "PTS #"]) expect(text).toContain(`${label} -`);
          expect(text).not.toContain("UNRELATED");
          expect(text).not.toContain("South");
        } else {
          for (const value of ["Legacy Client", "Legacy Consultant", "Legacy Manager", "Contract Value 0",
            "PTS # 0", "Legacy signed text", "Contract # -", "Main contractor -"]) expect(text).toContain(value);
          for (const excluded of ["North", "NORTH-CONTRACT", "STALE", "23-01-2026"]) expect(text).not.toContain(excluded);
        }
        const query = new PgDialect().sqlToQuery(conditions[index * 7 + 2]);
        expect(query.params).toContain(project.id);
        expect(query.params).toContain(org);
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("fetches scoped saved sources, all remarks and both distinct signers without writing records", async () => {
    const before = structuredClone(savedPlan);
    const res = await download();
    const data = mocks.render.mock.calls[0][0];
    expect(data).toMatchObject({
      title: "Saved project", reference: "PLAN-001", auditNumber: "AUD-1",
      startRemark: "Saved start", endRemark: "Saved end", openingRemark: "Saved opening\nSecond line", closingRemark: "-",
      lead: "Selected lead", programManager: "Original creator", auditee: "Saved auditee role",
      preparedBySignature: new Uint8Array([1, 2, 3]), programManagerSignature: undefined,
      revision: "To be mapped",
    });
    expect(data.opening).toContain("09:15");
    expect(data.project).toContainEqual(["Contract Value", "0"]);
    expect(data.activities[0]).toMatchObject({ section: "Saved Activity Label", auditee: "Saved auditee role" });
    expect(mocks.signature.mock.calls).toEqual([["lead-signature"], [null]]);
    expect(savedPlan).toEqual(before);
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "application/pdf");
    expect(tables).toEqual(["audit_plans", "audit_schedules", "projects", "audit_log_entries", "users", "workspace_roles", "master_data_values"]);
    const dialect = new PgDialect();
    for (const condition of conditions) expect(dialect.sqlToQuery(condition).params).toContain(org);
  });
  it("handles absent related records and unresolved saved people/roles as absent data", async () => {
    mocks.select.mockReset();
    for (const rows of [[savedPlan], [], [], [], [], [], []]) mocks.select.mockReturnValueOnce(selectResult(rows));
    await download();
    expect(mocks.render.mock.calls[0][0]).toMatchObject({
      lead: "-", team: "-", auditee: "-", programManager: "-", auditNumber: "-",
      startRemark: "Saved start", closingRemark: "-", preparedBySignature: undefined, programManagerSignature: undefined,
    });
  });
});
