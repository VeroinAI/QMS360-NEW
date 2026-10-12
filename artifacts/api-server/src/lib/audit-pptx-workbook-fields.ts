import { projectProgressPhases } from "@workspace/field-controls";
import type { ReportSectionData } from "./audit-consolidated-report";
import { mappedText, PPTX_UNMAPPED } from "./audit-pptx-mapping";

type Row = Record<string, any>;

/** Workbook-driven enrichment is exclusive to PPTX. Never overwrite a mapped value. */
export function fillAuditPptxWorkbookFields(sections: ReportSectionData[], input: {
  audit: Row; plan?: Row | null; schedule?: Row | null; project?: Row | null;
  evidence: Row[]; names: Map<string, string>; roleNames: Map<string, string>;
  cars: Row[]; findingReferences: Map<string, { reference: string; grade: string }>;
}) {
  const { audit, plan, schedule, project, evidence, names, roleNames } = input;
  const empty = (value: unknown) => mappedText(value) === PPTX_UNMAPPED;
  const field = (key: string, label: string) => sections.find(section => section.key === key)?.fields.find(field => field.label === label);
  const fill = (key: string, label: string, value: unknown) => {
    const target = field(key, label);
    if (target && empty(target.value) && !empty(value)) target.value = String(value);
  };
  const list = (items: unknown[]) => [...new Set(items.filter(item => !empty(item)).map(String))].join("\n");
  const projectField = (...keys: string[]) => {
    const normalize = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const key of keys) {
      const entry = Object.entries({ ...project?.customFields, ...project })
        .find(([name, value]) => normalize(name) === normalize(key) && !empty(value)
          && (typeof value === "string" || (typeof value === "number" && Number.isFinite(value))));
      if (entry) return entry[1];
    }
    return undefined;
  };
  fill("cover", "Project / process / site", project?.name || schedule?.departmentProject || schedule?.department);
  fill("document-control", "Form number", field("cover", "Audit reference")?.value);
  fill("document-control", "Process owner", names.get(schedule?.ownerId));
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
  for (const [label, aliases] of [
    ["Client", ["client", "clientName"]],
    ["Contractor", ["contractor", "contractorName"]],
    ["Contract / project number", ["contractNumber", "projectNumber", "contractProjectNo", "contractProjectNumber", "projectNo", "code"]],
    ["Contract signed", ["contractSigned", "contractSignedDate"]],
    ["Contract period", ["contractPeriod"]],
    ["TCC", ["tcc"]], ["PAC", ["pac"]], ["FAC", ["fac"]],
  ] as const) fill("audit-overview", label, projectField(...aliases));
  fill("cover", "Contract / project number", projectField("contractNumber", "projectNumber", "contractProjectNo", "projectNo", "code"));
  fill("scope", "Objective", plan?.description);
  fill("scope", "In scope", list((plan?.activities ?? []).map((row: Row) => row.section)));
  fill("scope", "Period and sample covered", list(evidence.map(file => file.fileName)));
  fill("scope", "Project phases covered", list((audit.checklist ?? []).map((row: Row) => row.auditArea)));
  fill("scope", "Method", plan?.auditMethod || plan?.method);
  fill("programme", "Auditees present", list((plan?.auditeeRoleIds ?? []).map((id: string) => roleNames.get(id))));

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
  if (conforming && !conforming.rows.length) {
    conforming.rows = (documents.goodPractices ?? []).map((row: Row) => [
      row.areaProcess, row.verifiedConforming, row.evidenceReference,
    ].map(value => empty(value) ? "Not recorded" : String(value)));
  }
  const tracker = sections.find(section => section.key === "corrective-actions")?.tables[0];
  tracker?.rows.forEach((row, index) => {
    const finding = input.findingReferences.get(input.cars[index]?.findingId);
    if (finding && empty(row[0])) row[0] = finding.reference;
    if (finding && empty(row[1])) row[1] = finding.grade;
  });
}
