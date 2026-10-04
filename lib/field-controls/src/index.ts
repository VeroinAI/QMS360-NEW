// Shared registry of admin-controllable forms and fields per application.
// This is the single source of truth for which form/field keys are valid in
// the organization_settings.branding.fieldControls matrix: the qms360 admin
// "Form Fields" tab renders it, and the api-server validates PUT
// /api/{app}/admin/field-controls payloads against it (unknown keys are
// rejected with 422 instead of being stored silently).

export * from "./qaqc-permissions";
export * from "./email-templates";
export type FieldControlAppKey = "qaqc" | "lessons" | "audit";

export type FieldDefinition = { key: string; label: string };
export type FormDefinition = { key: string; label: string; fields: FieldDefinition[] };

export const fieldControlRegistry: Record<FieldControlAppKey, FormDefinition[]> = {
  qaqc: [
    {
      key: "report-envelope",
      label: "QA/QC SOW report",
      fields: [
        { key: "projectId", label: "Project" },
        { key: "reportType", label: "Report type" },
        { key: "period", label: "Reporting period" },
        { key: "data", label: "Report data" },
      ],
    },
    {
      key: "metric",
      label: "Quality Metric Entry",
      fields: [
        { key: "projectId", label: "Project" },
        { key: "period", label: "Period" },
        { key: "category", label: "Category" },
        { key: "issuedCount", label: "Issued count" },
        { key: "closedCount", label: "Closed count" },
        { key: "ageing0To15", label: "Ageing 0–15 days" },
        { key: "ageing15To45", label: "Ageing 15–45 days" },
        { key: "ageingOver45", label: "Ageing over 45 days" },
        { key: "approverId", label: "Approver" },
      ],
    },
    {
      key: "material-inspection",
      label: "Material Inspection (MIR)",
      fields: [
        { key: "projectId", label: "Project" },
        { key: "period", label: "Period" },
        { key: "mirnTotal", label: "Total MIRN" },
        { key: "osdCount", label: "OSD" },
        { key: "approved", label: "Approved" },
        { key: "onHold", label: "On hold" },
        { key: "rejected", label: "Rejected" },
        { key: "hazardous", label: "Hazardous" },
        { key: "handleWithCare", label: "Handle with care" },
      ],
    },
    {
      key: "qtbt",
      label: "QTBT Entry",
      fields: [
        { key: "projectId", label: "Project" },
        { key: "period", label: "Period" },
        { key: "talkCount", label: "Talk count" },
        { key: "attendance", label: "Attendance" },
        { key: "durationMinutes", label: "Duration (minutes)" },
      ],
    },
    {
      key: "customer-satisfaction",
      label: "Customer Satisfaction Entry",
      fields: [
        { key: "projectId", label: "Project" },
        { key: "period", label: "Period" },
        { key: "serviceRatings", label: "Service ratings" },
        { key: "feedback", label: "Feedback" },
      ],
    },
    {
      key: "document-log",
      label: "Document Governance Log Entry",
      fields: [
        { key: "projectId", label: "Project" },
        { key: "date", label: "Date" },
        { key: "disciplineId", label: "Discipline" },
        { key: "documentType", label: "Document type" },
        { key: "status", label: "Status" },
        { key: "pendingWith", label: "Pending with" },
        { key: "reviewDays", label: "Review days" },
        { key: "pendingDays", label: "Pending days" },
        { key: "correspondenceCount", label: "Correspondence count" },
      ],
    },
    {
      key: "quality-brief",
      label: "Quality Brief",
      fields: [
        { key: "projectId", label: "Project" },
        { key: "period", label: "Period" },
        { key: "narrative", label: "Narrative" },
      ],
    },
  ],
  lessons: [
    {
      key: "lesson-form",
      label: "Lesson Learned Form",
      fields: [
        { key: "projectId", label: "Project Name" },
        { key: "title", label: "Title" },
        { key: "disciplineId", label: "Discipline" },
        { key: "categorisationId", label: "Categorization" },
        { key: "capturedAt", label: "Date" },
        { key: "gps", label: "Location (GPS)" },
        { key: "issueCategory", label: "Issue Category" },
        { key: "impact", label: "Impact" },
        { key: "description", label: "Description" },
        { key: "reference", label: "Reference" },
        { key: "isRepeatedIssue", label: "New / Repeated Issue" },
        { key: "repeatCount", label: "No. of times repeated" },
        { key: "repeatLocation", label: "Where was it repeated?" },
        { key: "rootCause", label: "Root Cause" },
        { key: "correction", label: "Correction" },
        { key: "correctiveAction", label: "Corrective Action" },
        { key: "remarks", label: "Remarks" },
        { key: "approverId", label: "Approver" },
      ],
    },
  ],
  audit: [
    {
      key: "schedule",
      label: "Audit Schedule",
      fields: [
        { key: "title", label: "Title" },
        { key: "year", label: "Year" },
        { key: "auditTypes", label: "Audit types" },
        { key: "plannedStartDate", label: "Planned start date" },
        { key: "plannedEndDate", label: "Planned end date" },
        { key: "ownerId", label: "Owner" },
        { key: "auditCategory", label: "Audit category" },
        { key: "departmentProject", label: "Department / project" },
        { key: "processProductOwner", label: "Process / product owner" },
        { key: "qaqcReference", label: "QA/QC reference" },
        { key: "auditNumber", label: "Audit number" },
        { key: "qaqcScope", label: "QA/QC scope" },
        { key: "qaqcClauses", label: "QA/QC clauses" },
        { key: "remarks", label: "Remarks" },
      ],
    },
    {
      key: "plan",
      label: "Audit Plan",
      fields: [
        { key: "scheduleId", label: "Schedule" },
        { key: "scope", label: "Scope" },
        { key: "objectives", label: "Objectives" },
        { key: "criteria", label: "Criteria" },
        { key: "auditDate", label: "Audit date" },
        { key: "location", label: "Location" },
        { key: "leadAuditorId", label: "Lead auditor" },
        { key: "teamMemberIds", label: "Team members" },
        { key: "processOwnerIds", label: "Process owners" },
        { key: "feasibilityNotes", label: "Feasibility notes" },
      ],
    },
    {
      key: "finding",
      label: "Audit Finding",
      fields: [
        { key: "auditId", label: "Audit" },
        { key: "title", label: "Title" },
        { key: "description", label: "Description" },
        { key: "clause", label: "Clause" },
        { key: "classification", label: "Classification" },
        { key: "priority", label: "Priority" },
        { key: "riskLevel", label: "Risk level" },
        { key: "responsibleDepartments", label: "Responsible departments" },
        { key: "raisedAt", label: "Raised at" },
      ],
    },
    {
      key: "car",
      label: "Corrective Action Report (CAR)",
      fields: [
        { key: "rootCause", label: "Root cause" },
        { key: "correction", label: "Correction" },
        { key: "correctiveAction", label: "Corrective action" },
      ],
    },
  ],
};

export function getFormDefinition(appKey: FieldControlAppKey, formKey: string): FormDefinition | undefined {
  return fieldControlRegistry[appKey].find((form) => form.key === formKey);
}

// Returns the unknown keys in a field-control matrix: bare form keys for
// unknown forms and "formKey.fieldKey" for unknown fields on known forms.
export function unknownFieldControlKeys(
  appKey: FieldControlAppKey,
  matrix: Record<string, Record<string, unknown>>,
): string[] {
  const unknown: string[] = [];
  for (const [formKey, fields] of Object.entries(matrix)) {
    const form = getFormDefinition(appKey, formKey);
    if (!form) {
      unknown.push(formKey);
      continue;
    }
    const valid = new Set(form.fields.map((field) => field.key));
    for (const fieldKey of Object.keys(fields ?? {})) {
      if (!valid.has(fieldKey)) unknown.push(`${formKey}.${fieldKey}`);
    }
  }
  return unknown;
}
