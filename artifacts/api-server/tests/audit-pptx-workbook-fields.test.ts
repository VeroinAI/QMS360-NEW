import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { buildConsolidatedAuditReport } from "../src/lib/audit-consolidated-report";
import { auditPptxMappings, PPTX_UNMAPPED } from "../src/lib/audit-pptx-mapping";
import { renderConsolidatedAuditPptx } from "../src/lib/audit-consolidated-pptx";

const fixture = () => ({
  audit: {
    title: "Selected audit", referenceNumber: "Execution reference",
    checklist: [{ id: "item", findingId: "finding", auditArea: "Construction", auditFinding: "Moderate NC", description: "Actual finding", clause: "8" }],
    additionalDocuments: {
      overallProjectProgress: [
        { id: "engineering-design", weight: 25, plan: 10, actual: 0, priorPeriod: null },
        { id: "construction", weight: null, plan: null, actual: 12, priorPeriod: 8 },
      ],
      goodPractices: [{ areaProcess: "Design", verifiedConforming: "Actual verified practice", evidenceReference: "Record X" }],
    },
  },
  plan: { leadAuditorId: "lead", description: "Recorded audit description", auditeeRoleIds: ["role"], activities: [{ section: "Design" }] },
  schedule: { qaqcReference: "QAM-IA/26-001", ownerId: "owner" },
  project: { name: "Selected project", code: "P001", customFields: { Client: "Recorded client", Contractor: "Recorded contractor", Contract: "Contract details", "Contract Period": "24 months" } },
  names: new Map([["lead", "Selected lead"], ["owner", "Selected owner"]]),
  roleNames: new Map([["role", "Selected auditee role"]]),
  legacyFindings: [],
  cars: [{ findingId: "finding", rootCause: "Actual root cause", ownerId: "lead", status: "Submitted" }],
  evidence: [{ id: "file", fileName: "Submitted file.pdf", mimeType: "application/pdf" }],
});
const build = (data = fixture()) => buildConsolidatedAuditReport({ ...data, pptxWorkbookMappings: true });
const field = (data: ReturnType<typeof build>, section: string, label: string) =>
  data.find(row => row.key === section)!.fields.find(row => row.label === label)!.value;

describe("Audit Report Conditions workbook: missing PPTX fields only", () => {
  it("fills document control with the audit reference, selected owner and selected lead without fabricated sign-offs", () => {
    const sections = build();
    expect(field(sections, "document-control", "Form number")).toBe("QAM-IA/26-001");
    expect(field(sections, "document-control", "Process owner")).toBe("Selected owner");
    expect(field(sections, "document-control", "Applies to")).toBe("All quality internal audits conducted by Algihaz auditors");
    const table = auditPptxMappings(sections).get(2)!.tables[0]!;
    expect(table[0]).toEqual(["Prepared by", "Selected lead", PPTX_UNMAPPED, PPTX_UNMAPPED]);
    expect(table[1]).toEqual(["Reviewed by", PPTX_UNMAPPED, PPTX_UNMAPPED, PPTX_UNMAPPED]);
    expect(table[2]).toEqual(["Approved by", PPTX_UNMAPPED, PPTX_UNMAPPED, PPTX_UNMAPPED]);
  });
  it("maps missing scope, submitted file names, checklist areas and auditee roles", () => {
    const sections = build();
    expect(field(sections, "scope", "Objective")).toBe("Recorded audit description");
    expect(field(sections, "scope", "In scope")).toBe("Design");
    expect(field(sections, "scope", "Period and sample covered")).toBe("Submitted file.pdf");
    expect(field(sections, "scope", "Project phases covered")).toBe("Construction");
    expect(field(sections, "programme", "Auditees present")).toBe("Selected auditee role");
    expect(auditPptxMappings(sections).get(4)!.shapes[21]).toContain("Method: To be mapped");
  });
  it("uses project master values where available and retains missing project fields", () => {
    const sections = build();
    expect(field(sections, "audit-overview", "Client")).toBe("Recorded client");
    expect(field(sections, "audit-overview", "Contractor")).toBe("Recorded contractor");
    expect(field(sections, "audit-overview", "Contract period")).toBe("24 months");
    expect(auditPptxMappings(sections).get(3)!.shapes[35]).toBe(PPTX_UNMAPPED);
  });
  it("does not guess a contractor from contract details or a report approver from unrelated users", () => {
    const data = fixture();
    delete (data.project.customFields as Record<string, string>).Contractor;
    const sections = build(data);
    expect(auditPptxMappings(sections).get(3)!.shapes[27]).toBe(PPTX_UNMAPPED);
    expect(auditPptxMappings(sections).get(2)!.tables[0]![2]![1]).toBe(PPTX_UNMAPPED);
  });
  it("does not promote a legacy first-team-member default into a selected report preparer", () => {
    const sections = build({ ...fixture(), plan: { ...fixture().plan, pptxPreparedById: null } } as ReturnType<typeof fixture>);
    expect(auditPptxMappings(sections).get(2)!.tables[0]![0]![1]).toBe(PPTX_UNMAPPED);
    expect(field(sections, "audit-overview", "Lead auditor")).toBe("Selected lead");
  });
  it("reads manually saved Additional Documents progress with zero and blank values intact, without an invented weighted total", () => {
    const table = auditPptxMappings(build()).get(8)!.tables[0]!;
    expect(table).toEqual([
      ["Engineering & Design", "25%", "10", "0", "-10", PPTX_UNMAPPED],
      ["Construction", PPTX_UNMAPPED, PPTX_UNMAPPED, "12", PPTX_UNMAPPED, "8"],
    ]);
    expect(table.some(row => row[0] === "Overall")).toBe(false);
  });
  it("maps conforming records and resolves CAR references and grades through linked checklist findings", () => {
    const mapped = auditPptxMappings(build());
    expect(mapped.get(10)!.tables[0]).toEqual([["Design", "Actual verified practice", "Record X"]]);
    expect(mapped.get(15)!.tables[0]![0]!.slice(0, 3)).toEqual([PPTX_UNMAPPED, "Moderate", "Actual root cause"]);
    expect(mapped.get(11)!.tables[0]![0]![0]).toBe(PPTX_UNMAPPED);
  });
  it("does not overwrite existing report values or mutate the source audit, plan or other export sections", () => {
    const data = {
      ...fixture(),
      audit: { ...fixture().audit, reportDetails: {
        values: { objective: "Existing objective", formNumber: "Existing form number", processOwner: "Existing owner" },
        rows: { documentApprovals: [{ role: "Prepared by", name: "Existing preparer", signature: "Existing signature", date: "2026-10-01" }] },
      } },
    };
    const before = JSON.stringify(data);
    const sections = build(data);
    expect(field(sections, "scope", "Objective")).toBe("Existing objective");
    expect(field(sections, "document-control", "Form number")).toBe("Existing form number");
    expect(field(sections, "document-control", "Process owner")).toBe("Existing owner");
    expect(sections.find(row => row.key === "document-control")!.tables[0]!.rows[0])
      .toEqual(["Prepared by", "Existing preparer", "Existing signature", "2026-10-01"]);
    const unchanged = buildConsolidatedAuditReport(data);
    const optedOut = buildConsolidatedAuditReport({ ...data, pptxWorkbookMappings: false });
    expect(optedOut).toEqual(unchanged);
    for (const key of ["executive-summary", "findings-summary", "ofi", "photographs", "grading", "conclusion"]) {
      expect(sections.find(row => row.key === key)).toEqual(unchanged.find(row => row.key === key));
    }
    expect(JSON.stringify(data)).toBe(before);
  });
  it("maps Requirements to Audit Area and keeps an empty Findings Description unavailable instead of substituting a checklist question", () => {
    const data = fixture();
    data.audit.checklist[0] = { ...data.audit.checklist[0]!, description: "", question: "A checklist question" } as typeof data.audit.checklist[0];
    const mapped = auditPptxMappings(build(data)).get(11)!.tables[0]![0]!;
    expect(mapped[1]).toContain(PPTX_UNMAPPED);
    expect(mapped[1]).not.toContain("A checklist question");
    expect(mapped[3]).toBe("Construction");
    expect(mapped[2]).toBe(PPTX_UNMAPPED);
    expect(auditPptxMappings(buildConsolidatedAuditReport(data)).get(11)!.tables[0]![0]![3]).toBe("8");
  });
  it("uses Plan Auditee Roles even when meeting attendee names have been saved", () => {
    const data = { ...fixture(), audit: { ...fixture().audit, openingMeeting: { attendees: ["lead"] } } };
    expect(field(build(data), "programme", "Auditees present")).toBe("Selected auditee role");
    expect(field(buildConsolidatedAuditReport(data), "programme", "Auditees present")).toBe("Selected lead");
  });
  it("includes checklist areas with zero findings without counting Not applicable as a finding", () => {
    const data = fixture();
    data.audit.checklist.push({ id: "unclassified", findingId: "", auditArea: "Design", auditFinding: "Not applicable", description: "Not a finding", clause: "9" });
    expect(auditPptxMappings(build(data)).get(7)!.tables[0]).toContainEqual(["Design", "0", "0", "0", "0", "0"]);
  });
  it("includes only NC/OFI image evidence in PPTX and never treats upload time or classification as capture date", () => {
    const data = { ...fixture(), audit: { ...fixture().audit, checklist: [{ ...fixture().audit.checklist[0], evidenceIds: ["linked"] }] },
      evidence: [
        { id: "linked", fileName: "finding.png", mimeType: "image/png", createdAt: "2026-10-12" },
        { id: "unlinked", fileName: "unrelated.png", mimeType: "image/png" },
      ] };
    const photos = build(data).find(section => section.key === "photographs")!.photos;
    expect(photos.map(photo => photo.fileName)).toEqual(["finding.png"]);
    expect(photos[0]!.description).toContain("Date captured: Not recorded");
    expect(buildConsolidatedAuditReport(data).find(section => section.key === "photographs")!.photos).toHaveLength(2);
    expect(auditPptxMappings(build(data)).get(11)!.tables[0]![0]![2]).toBe("finding.png");
  });
  it("keeps different findings on separate photographic slides and continues all images for one finding", async () => {
    const sections = build();
    sections.find(section => section.key === "photographs")!.photos = [
      { id: "one", fileName: "one.png", reference: "B.1.1", description: "Grade: Major" },
      { id: "two", fileName: "two.png", reference: "B.2.1", description: "Grade: OFI" },
      { id: "three", fileName: "three.png", reference: "B.1.1", description: "Grade: Major" },
      { id: "four", fileName: "four.png", reference: "B.1.1", description: "Grade: Major" },
    ];
    // A real PNG is necessary to exercise OOXML image embedding and continuation.
    const sharp = (await import("sharp")).default;
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#ffffff" } }).png().toBuffer();
    const photos = new Map(["one", "two", "three", "four"].map(id => [id, png]));
    const output = unzipSync(await renderConsolidatedAuditPptx({ sections, photos }));
    const pages = Object.entries(output).filter(([name]) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .map(([, xml]) => strFromU8(xml)).filter(xml => /one\.png|two\.png|three\.png|four\.png/.test(xml));
    expect(pages).toHaveLength(3);
    expect(pages.some(page => page.includes("one.png") && page.includes("three.png"))).toBe(true);
    expect(pages.some(page => page.includes("two.png") && /one\.png|three\.png|four\.png/.test(page))).toBe(false);
    expect(pages.some(page => page.includes("four.png"))).toBe(true);
  });
  it("writes the filled fields to the real PPTX, omits only slide 16 and preserves grading and template styles", async () => {
    const sections = build();
    const original = unzipSync(await renderConsolidatedAuditPptx({ sections }));
    const output = unzipSync(await renderConsolidatedAuditPptx({ sections, skipPriorityActions: true }));
    const xml = (name: string) => strFromU8(output[name]!);
    expect(xml("ppt/slides/slide2.xml")).toContain("Selected owner");
    expect(xml("ppt/slides/slide2.xml")).toContain("Selected lead");
    expect(xml("ppt/slides/slide2.xml")).toContain("QAM-IA/26-001");
    expect(xml("ppt/slides/slide8.xml")).toContain("Engineering");
    expect(xml("ppt/slides/slide15.xml")).toContain("Actual root cause");
    const presentation = xml("ppt/presentation.xml");
    const oldPresentation = strFromU8(original["ppt/presentation.xml"]!);
    expect((presentation.match(/<p:sldId /g) ?? []).length).toBe((oldPresentation.match(/<p:sldId /g) ?? []).length - 1);
    expect(output["ppt/slides/slide14.xml"]).toEqual(original["ppt/slides/slide14.xml"]);
    for (const name of Object.keys(original).filter(name => /^ppt\/(slideMasters|slideLayouts|theme)\//.test(name))) {
      expect(output[name]).toEqual(original[name]);
    }
  });
});
