import { projectProgressPhases } from "@workspace/field-controls";
import { formatDate, formatDateInTimeZone } from "@workspace/spreadsheet-dates";
import type { ReportSectionData } from "./audit-consolidated-report";
import { mappedText, PPTX_EMPTY, PPTX_UNMAPPED } from "./audit-pptx-mapping";

type Row = Record<string, any>;

/** Ignore unused form rows before missing cells are converted to report placeholders. */
export const recordedGoodPractice = (row: Row) =>
  ["areaProcess", "verifiedConforming", "evidenceReference", "referenceNumber"]
    .some(key => row[key] != null && String(row[key]).trim() !== "");

/** PPTX-only enrichment. Explicit live-source mappings override stale report-detail values. */
export function fillAuditPptxWorkbookFields(sections: ReportSectionData[], input: {
  audit: Row; plan?: Row | null; schedule?: Row | null; project?: Row | null;
  evidence: Row[]; names: Map<string, string>; roleNames: Map<string, string>;
  cars: Row[]; findingReferences: Map<string, { reference: string; grade: string; findingNumber?: string }>;
  pptxProcessOwnerNames?: string[]; generatedAt?: Date; timeZone?: string;
}) {
  const { audit, plan, schedule, project, evidence, names, roleNames } = input;
  const empty = (value: unknown) => [PPTX_EMPTY, PPTX_UNMAPPED].includes(mappedText(value));
  const field = (key: string, label: string) => sections.find(section => section.key === key)?.fields.find(field => field.label === label);
  const fill = (key: string, label: string, value: unknown) => {
    const target = field(key, label);
    if (target && empty(target.value) && !empty(value)) target.value = String(value);
  };
  const list = (items: unknown[]) => [...new Set(items.filter(item => !empty(item)).map(String))].join("\n");
  fill("cover", "Project / process / site", project?.name || schedule?.departmentProject || schedule?.department);
  fill("document-control", "Form number", field("cover", "Audit reference")?.value);
  const processOwner = field("document-control", "Process owner");
  if (processOwner) processOwner.value = [...new Set(input.pptxProcessOwnerNames?.map(name => name.trim()).filter(Boolean) ?? [])].join(", ") || PPTX_EMPTY;
  const effectiveDate = field("document-control", "Effective date");
  if (effectiveDate) effectiveDate.value = formatDateInTimeZone(input.generatedAt ?? new Date(), input.timeZone ?? "Asia/Riyadh");
  fill("document-control", "Applies to", "All quality internal audits conducted by Algihaz auditors");
  const approvals = sections.find(section => section.key === "document-control")?.tables[0];
  const preparedById = plan && "pptxPreparedById" in plan ? plan.pptxPreparedById : plan?.leadAuditorId;
  if (approvals) {
    const roles = ["Prepared by", "Reviewed by", "Approved by"];
    for (let i = 0; i < roles.length; i++) {
      const role = roles[i]!;
      let row = approvals.rows.find(row => row[0]?.toLowerCase() === role.toLowerCase());
      if (!row && empty(approvals.rows[i]?.[0])) {
        row = approvals.rows[i] ?? ["Not recorded", "Not recorded", "Not recorded", "Not recorded"];
        row[0] = role;
        approvals.rows[i] = row;
      }
      // A selected lead is known; role grants alone do not identify a report reviewer/approver.
      if (row && role === "Prepared by" && empty(row[1]) && names.has(preparedById)) {
        row[1] = names.get(preparedById)!;
      }
    }
  }
  // Slide 3's profile explicitly uses this audit project's QMS Additional Data.
  // A cleared mapped value stays empty, never reverting to old report/source-master text.
  const additional = project?.customFields?.qmsAdditionalData ?? {};
  for (const [label, key] of [
    ["Client", "client"], ["Contractor", "contractor"],
    ["Contract / project number", "contractProjectNumber"], ["Contract signed", "contractSigned"],
    ["Contract period", "contractPeriod"], ["TCC", "tcc"], ["PAC", "pac"], ["FAC", "fac"],
  ] as const) {
    const target = field("audit-overview", label);
    if (!target) continue;
    const saved = typeof additional[key] === "string" ? additional[key].trim() : "";
    target.value = saved ? (key === "contractSigned" ? formatDate(saved) : saved) : PPTX_EMPTY;
  }
  const coverContract = field("cover", "Contract / project number");
  if (coverContract) coverContract.value = typeof additional.contractProjectNumber === "string"
    ? additional.contractProjectNumber.trim() || PPTX_EMPTY : PPTX_EMPTY;
  fill("scope", "Objective", plan?.description);
  fill("scope", "In scope", list((plan?.activities ?? []).map((row: Row) => row.section)));
  fill("scope", "Period and sample covered", list(evidence.map(file => file.fileName)));
  fill("scope", "Project phases covered", list((audit.checklist ?? []).map((row: Row) => row.auditArea)));
  fill("scope", "Method", plan?.auditMethod || plan?.method);
  // This workbook explicitly maps participation to the Plan's Auditee Roles,
  // independently of the meeting's attendee user selection.
  const auditees = field("programme", "Auditees present");
  if (auditees) auditees.value = list((plan?.auditeeRoleIds ?? []).map((id: string) => roleNames.get(id))) || "Not recorded";

  const documents = audit.additionalDocuments ?? {};
  const progress = sections.find(section => section.key === "project-progress")?.tables[0];
  const number = (value: unknown, suffix = "") => typeof value === "number" && Number.isFinite(value) ? `${value}${suffix}` : "Not recorded";
  const progressRows = (documents.overallProjectProgress ?? []).map((row: Row) => [
    row.phase || projectProgressPhases.find(([id]) => id === row.id)?.[1] || "Not recorded",
    number(row.weight, "%"), number(row.plan), number(row.actual),
    typeof row.plan === "number" && typeof row.actual === "number" ? number(Number((row.actual - row.plan).toFixed(10))) : "Not recorded",
    number(row.priorPeriod),
  ]);
  if (progress && progressRows.length) {
    if (!progress.rows.length) progress.rows = progressRows;
    else for (const row of progress.rows) {
      const source = progressRows.find((source: string[]) => source[0] === row[0]);
      if (source) row.forEach((value, index) => { if (empty(value) && !empty(source[index])) row[index] = source[index]!; });
    }
  }
  const conforming = sections.find(section => section.key === "conforming")?.tables[0];
  if (conforming) {
    const practices = (documents.goodPractices ?? []).filter(recordedGoodPractice).map((row: Row) => [
      row.areaProcess, row.verifiedConforming, row.evidenceReference,
    ].map(value => empty(value) ? "Not recorded" : String(value)));
    for (const row of practices) {
      if (!conforming.rows.some(existing => existing.join("\0") === row.join("\0"))) conforming.rows.push(row);
    }
  }
  const tracker = sections.find(section => section.key === "corrective-actions")?.tables[0];
  tracker?.rows.forEach((row, index) => {
    const finding = input.findingReferences.get(input.cars[index]?.findingId);
    // CAR reference is issued independently from the underlying finding.
    row[0] = finding?.findingNumber?.trim() || PPTX_EMPTY;
    row[1] = input.cars[index]?.carNumber || PPTX_EMPTY;
    if (finding && empty(row[2])) row[2] = finding.grade;
  });
}
