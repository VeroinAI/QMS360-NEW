export type EmailRuleTemplate = { subjectTemplate?: string; bodyTemplate?: string };
export const emailTemplateFields = [
  "recipient_name", "recipient_email", "actor_name", "creator_name", "system_name",
  "record_reference", "record_name", "audit_name", "audit_schedule_name",
  "audit_start_date", "audit_end_date", "approval_level", "next_approval_level",
  "review_comments", "audit_area", "audit_description", "audit_finding",
] as const;
const aliases: Record<string, string> = {
  audit_program_manager_name: "creator_name", program_manager_name: "creator_name",
  process_product_owner_name: "recipient_name", action_taker: "recipient_name",
  audit_from_date: "audit_start_date", audit_to_date: "audit_end_date",
  l1_rejection_reason: "review_comments", l2_rejection_reason: "review_comments", l3_rejection_reason: "review_comments",
};
const tokenPattern = /\{\{?\s*([^{}]+?)\s*\}?\}/g;
function fieldKey(value: string) {
  const key = value.trim().toLowerCase().replace(/[\s/]+/g, "_");
  return aliases[key] ?? key;
}
export function unknownEmailTemplateFields(template: string) {
  return [...new Set([...template.matchAll(tokenPattern)].map(match => fieldKey(match[1]))
    .filter(key => !(emailTemplateFields as readonly string[]).includes(key)))];
}
export function renderEmailRuleTemplate(
  template: EmailRuleTemplate | undefined,
  defaults: { subject: string; text: string },
  values: Record<string, unknown>,
) {
  const render = (value: string) => value.replace(tokenPattern, (_match, token: string) => {
    const replacement = values[fieldKey(token)];
    return replacement == null || replacement === "" ? "Not available" : String(replacement);
  });
  return {
    subject: template?.subjectTemplate?.trim() ? render(template.subjectTemplate).replace(/[\r\n]+/g, " ") : defaults.subject,
    text: template?.bodyTemplate?.trim() ? render(template.bodyTemplate) : defaults.text,
  };
}
export const auditEmailTemplateExamples = {
  request: {
    label: "Schedule approval request",
    subjectTemplate: "{audit_schedule_name} – {next_approval_level} Approval Required",
    bodyTemplate: "Dear {recipient_name},\n\nThe audit schedule for {audit_schedule_name} is ready for your review.\n\nKindly review the schedule and provide your approval to proceed with the next stage of the audit process.\n\nAudit Schedule: {audit_schedule_name}\nAudit Period: {audit_start_date} to {audit_end_date}\n\nRegards,\n{creator_name}\nAudit Program Manager",
  },
  approved: {
    label: "Schedule fully approved",
    subjectTemplate: "{audit_schedule_name} – Approved",
    bodyTemplate: "Dear {recipient_name},\n\nThe audit schedule for {audit_schedule_name} has been reviewed and received final approval.\n\nAudit Schedule: {audit_schedule_name}\nAudit Period: {audit_start_date} to {audit_end_date}\n\nRegards,\n{system_name}",
  },
  sendBack: {
    label: "Schedule sent back",
    subjectTemplate: "{audit_schedule_name} – Sent back by {approval_level}",
    bodyTemplate: "Dear {recipient_name},\n\nThe audit schedule for {audit_schedule_name} has been sent back and requires correction.\n\nAudit Schedule: {audit_schedule_name}\nReview comments: {review_comments}\n\nKindly make the required corrections and resubmit the audit schedule for approval.\n\nRegards,\n{system_name}",
  },
  plan: {
    label: "Audit Plan circulation",
    subjectTemplate: "Audit Plan – {audit_name}",
    bodyTemplate: "Dear {recipient_name},\n\nThe Audit Plan for {audit_name} has been created by the Audit Program Manager.\n\nPlease review the Audit Plan and proceed with the necessary actions as applicable.\n\nRegards,\n{creator_name}\nAudit Program Manager",
  },
  finding: {
    label: "Corrective action required",
    subjectTemplate: "{audit_name} – Corrective Action Required",
    bodyTemplate: "Dear {recipient_name},\n\nA finding in {audit_name} has been marked against you. It requires your corrective action.\n\nAudit Name: {audit_name}\nAudit Area: {audit_area}\nAudit Description: {audit_description}\nAudit Finding: {audit_finding}\n\nKindly review the Audit finding and proceed with the necessary corrective actions as applicable.\n\nRegards,\n{system_name}",
  },
  report: {
    label: "Audit Report circulation",
    subjectTemplate: "{audit_name} – Report",
    bodyTemplate: "Dear {recipient_name},\n\nPlease review the audit report for {audit_name}, conducted from {audit_start_date} to {audit_end_date}.\n\nKindly review the Audit report and proceed with the necessary corrective actions as applicable.\n\nRegards,\n{system_name}",
  },
};