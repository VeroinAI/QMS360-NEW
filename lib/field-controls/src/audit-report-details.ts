export type AuditReportDetailsData = {
  values: Record<string, string>;
  rows: Record<string, Array<Record<string, string>>>;
};
type Field = { key: string; label: string; type?: "date" | "textarea" | "select"; options?: string[] };
type Collection = { key: string; label: string; columns: Field[] };
type Group = { key: string; label: string; fields: Field[]; collections?: Collection[] };
const f = (key: string, label: string, type?: Field["type"]): Field => ({ key, label, type });
export const auditReportDetailGroups: Group[] = [
  { key: "document", label: "Document control", fields: [
    f("reportRevision", "Report revision"), f("formTitle", "Form title"), f("formNumber", "Form number"),
    f("formRevision", "Form revision"), f("effectiveDate", "Effective date", "date"),
    f("processOwner", "Process owner"), f("appliesTo", "Applies to", "textarea"),
  ], collections: [
    { key: "documentApprovals", label: "Document approval", columns: [f("role", "Role"), f("name", "Name and title"), f("signature", "Signature details"), f("date", "Date", "date")] },
    { key: "revisionHistory", label: "Revision history", columns: [f("revision", "Revision"), f("date", "Date", "date"), f("description", "Description of change"), f("by", "By")] },
  ] },
  { key: "profile", label: "Project profile", fields: [
    f("client", "Client"), f("contractor", "Contractor"), f("contractNumber", "Contract / project number"),
    f("contractSigned", "Contract signed", "date"), f("contractPeriod", "Contract period"),
    f("tcc", "TCC"), f("pac", "PAC"), f("fac", "FAC"), f("location", "Location / department"),
  ] },
  { key: "scope", label: "Objective, scope, criteria and method", fields: [
    f("objective", "Objective", "textarea"), f("inScope", "In scope", "textarea"),
    f("notInScope", "Not in scope / not audited, and why", "textarea"), f("samplePeriod", "Period and sample covered", "textarea"),
    f("projectPhases", "Project phases covered", "textarea"), f("criteria", "Audit criteria", "textarea"),
    f("method", "Audit method", "textarea"), f("samplingBasis", "Sampling basis", "textarea"),
    f("notRepresented", "Not represented / participation limitations", "textarea"),
  ] },
  { key: "summary", label: "Executive summary and recurring themes", fields: [
    { key: "overallRating", label: "Overall rating", type: "select", options: ["Effective", "Effective with improvements required", "Not effective"] },
    f("overallConclusion", "Overall conclusion", "textarea"), f("keyMessages", "Key messages (one per line)", "textarea"),
  ], collections: [{ key: "recurringThemes", label: "Recurring themes", columns: [f("theme", "Theme / systemic cause"), f("indication", "What it indicates"), f("references", "Finding references")] }] },
  { key: "progress", label: "Overall project progress (when applicable)", fields: [
    f("progressDataAsAt", "Data as at", "date"), f("progressSource", "Source report reference"),
    f("progressComment", "Auditor comment", "textarea"),
  ], collections: [{ key: "progress", label: "Project phases", columns: [
    f("phase", "Phase"), f("weight", "Weight %"), f("plan", "Plan %"), f("actual", "Actual %"), f("priorPeriod", "Prior period %"),
  ] }] },
  { key: "actions", label: "Recommended priority actions", fields: [], collections: [
    { key: "containRisk", label: "Contain the risk now", columns: [f("action", "Action"), f("reference", "Finding reference")] },
    { key: "correctClose", label: "Correct and close", columns: [f("action", "Action"), f("reference", "Finding reference")] },
    { key: "preventRecurrence", label: "Prevent recurrence", columns: [f("action", "Action"), f("reference", "Finding reference")] },
  ] },
  { key: "photographs", label: "Photograph captions", fields: [], collections: [
    { key: "photographs", label: "Photographs (match the uploaded evidence file name)", columns: [
      f("fileName", "Evidence file name"), f("reference", "Finding reference"),
      { key: "grade", label: "Grade", type: "select", options: ["Major", "Moderate", "Minor", "OFI"] },
      f("date", "Date captured", "date"), f("location", "Location"), f("description", "Description", "textarea"),
      f("requirement", "Requirement / clause"),
    ] },
  ] },
  { key: "conclusion", label: "Conclusion, distribution and sign-off", fields: [
    f("headlineConclusion", "Headline conclusion"), f("objectivesAchieved", "Were the objectives achieved?", "textarea"),
    f("effectivenessConclusion", "System effectiveness and priority findings", "textarea"),
    f("followUpDate", "Follow-up audit date", "date"), f("followUpScope", "Follow-up audit scope", "textarea"),
    f("reportIssueDate", "Report issue date", "date"), f("distribution", "Distribution (names / departments)", "textarea"),
  ], collections: [{ key: "signOff", label: "Report sign-off", columns: [f("role", "Role"), f("name", "Name and title"), f("signature", "Signature details"), f("date", "Date", "date")] }] },
];
export function auditReportDetailsErrors(details: AuditReportDetailsData): string[] {
  const errors: string[] = [];
  const fields = new Map(auditReportDetailGroups.flatMap(g => g.fields).map(field => [field.key, field]));
  const collections = new Map(auditReportDetailGroups.flatMap(g => g.collections ?? []).map(collection => [collection.key, collection]));
  const check = (field: Field, value: string) => {
    if (field.type === "select" && value && !field.options?.includes(value)) errors.push(`Invalid ${field.label}`);
    if (field.type === "date" && value && (!/^\d{4}-\d{2}-\d{2}$/.test(value)
      || !Number.isFinite(new Date(`${value}T00:00:00Z`).getTime())
      || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)) errors.push(`Invalid ${field.label}`);
  };
  for (const [key, value] of Object.entries(details.values)) {
    const field = fields.get(key);
    if (!field) errors.push(`Unsupported report field: ${key}`); else check(field, value);
  }
  for (const [key, rows] of Object.entries(details.rows)) {
    const collection = collections.get(key);
    if (!collection) { errors.push(`Unsupported report table: ${key}`); continue; }
    for (const row of rows) for (const [column, value] of Object.entries(row)) {
      const field = collection.columns.find(f => f.key === column);
      if (!field) errors.push(`Unsupported ${collection.label} column: ${column}`); else check(field, value);
      if (key === "progress" && column !== "phase" && value.trim() && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100))
        errors.push(`${field?.label ?? column} must be a percentage from 0 to 100`);
    }
  }
  const progress = details.rows.progress ?? [];
  for (const row of details.rows.photographs ?? []) {
    if (Object.values(row).some(value => value.trim()) && !row.fileName?.trim()) errors.push("Enter the evidence file name for each photograph caption");
  }
  if (progress.length && progress.every(r => r.weight?.trim()) && Math.abs(progress.reduce((sum, row) => sum + Number(row.weight), 0) - 100) > 0.01)
    errors.push("Project phase weights must total 100%");
  return errors;
}