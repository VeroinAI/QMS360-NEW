import { beforeEach, describe, expect, it, vi } from "vitest";
import { emailReportOptions, validEmailReportSelection } from "@workspace/field-controls";
const mocks = vi.hoisted(() => ({ generate: vi.fn(), deliver: vi.fn(), remove: vi.fn() }));
vi.mock("./email-report-generator", () => ({ generateEmailReport: mocks.generate }));
vi.mock("./email", () => ({ deliverEmail: mocks.deliver }));
vi.mock("./email-attachments", () => ({ removeEmailPdfAttachment: mocks.remove }));
vi.mock("./email-placeholder-values", () => ({ prepareCustomPlaceholderValues: async () => () => ({}) }));
import { enqueueEmail, processClaimedEmail } from "./email-queue";

const org = "11111111-1111-4111-8111-111111111111";
const entityId = "22222222-2222-4222-8222-222222222222";
const to = [{ email: "recipient@example.test", name: "Recipient" }];
function fixture() {
  const inserted: any[] = [], updates: any[] = [];
  const database = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    insert: () => ({ values: async (rows: any[]) => { inserted.push(...rows); } }),
    update: () => ({ set: (values: any) => { updates.push(values); return { where: async () => [] }; } }),
  } as any;
  return { database, inserted, updates };
}
const input = {
  organizationId: org, recipientIds: [], recipients: to, subject: "Report", text: "Body",
  context: { kind: "email_event_rule", app: "lessons", eventType: "lessons.lesson_form.submit", entityId },
};
const attachment = { filename: "lesson.pdf", contentType: "application/pdf", objectPath: "/private/snapshot.pdf" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.generate.mockResolvedValue(attachment);
  mocks.deliver.mockResolvedValue({ attempted: true, sent: 1, failed: 0, failedRecipients: [] });
});

describe("Email report event boundaries", () => {
  it("offers only matching reports and none for events without a report", () => {
    expect(emailReportOptions("lessons.lesson_form.approve").map(x => x.value)).toEqual(["lesson_pdf"]);
    expect(emailReportOptions("audit.audit.complete").map(x => x.value)).toEqual(["audit_report_pdf", "audit_report_pptx"]);
    expect(emailReportOptions("audit.audit_plan.send_for_audit").map(x => x.value)).toEqual(["audit_plan_pdf"]);
    expect(emailReportOptions("qaqc.qaqc_report.submit").map(x => x.value)).toEqual(["qaqc_report_pdf"]);
    expect(emailReportOptions("lessons.lesson_form.delete")).toEqual([]);
    expect(validEmailReportSelection("lessons.lesson_form.submit", "audit_report_pptx")).toBe(false);
    expect(validEmailReportSelection("audit.audit.complete", "../report.pdf")).toBe(false);
  });
  it.each([undefined, null])("No attachment (%s) suppresses implicit attachments on configured rules", async selection => {
    const { database, inserted } = fixture();
    await enqueueEmail(database, { ...input, ruleTemplate: { reportAttachment: selection },
      attachments: [attachment as any] });
    expect(inserted[0].context.emailAttachments).toBeUndefined();
    expect(inserted[0].context.emailReportRequest).toBeUndefined();
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("persists the selected event report, not a URL, for retryable generation", async () => {
    const { database, inserted } = fixture();
    await enqueueEmail(database, { ...input, ruleTemplate: { reportAttachment: "lesson_pdf" } });
    expect(inserted[0].context.emailReportRequest).toEqual({ selection: "lesson_pdf", eventType: input.context.eventType, entityId });
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("rejects a cross-module report even for a forged API request", async () => {
    const { database, inserted } = fixture();
    await expect(enqueueEmail(database, { ...input, ruleTemplate: { reportAttachment: "audit_report_pptx" } })).rejects.toThrow("does not belong");
    expect(inserted).toHaveLength(0);
  });
  it("reuses a prepared final-approval PDF when that report is explicitly selected", async () => {
    const { database, inserted } = fixture();
    await enqueueEmail(database, { ...input,
      context: { ...input.context, eventType: "audit.audit_programme.approved_final" },
      ruleTemplate: { reportAttachment: "audit_schedule_pdf" }, attachments: [attachment as any] });
    expect(inserted[0].context.emailAttachments).toEqual([attachment]);
    expect(inserted[0].context.emailReportRequest).toBeUndefined();
  });
  it("retains attachments for independent automation and already-queued legacy messages", async () => {
    const { database, inserted } = fixture();
    await enqueueEmail(database, { ...input, context: { ...input.context, kind: "scheduled_distribution" }, attachments: [attachment as any] });
    expect(inserted[0].context.emailAttachments).toEqual([attachment]);
  });
});

describe("Queued selected-report delivery", () => {
  const queued = () => ({ id: "queue", organizationId: org, context: {
    emailReportRequest: { selection: "lesson_pdf", eventType: input.context.eventType, entityId },
    emailToRecipients: to,
  }, recipientEmail: to[0].email, ccRecipients: [], subject: "Report", bodyText: "Body",
    senderEmail: null, attemptCount: 0, maxAttempts: 3 }) as any;
  it("stores the private snapshot before SMTP and reuses it on a delivery retry", async () => {
    const { database, updates } = fixture(), row = queued();
    mocks.deliver.mockResolvedValueOnce({ attempted: true, sent: 0, failed: 1, failedRecipients: to, error: "temporary SMTP failure" });
    await processClaimedEmail(database, row);
    expect(updates[0].context.emailAttachments).toEqual([attachment]);
    expect(mocks.generate).toHaveBeenCalledWith(org, row.context.emailReportRequest);
    expect(mocks.deliver.mock.calls[0][1].attachments).toEqual([attachment]);
    await processClaimedEmail(database, row);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    expect(updates.at(-1).deliveryStatus).toBe("sent");
  });
  it("retries attachment failures without sending an attachment-less email", async () => {
    const { database, updates } = fixture();
    mocks.generate.mockRejectedValueOnce(new Error("Report not available"));
    await processClaimedEmail(database, queued());
    expect(mocks.deliver).not.toHaveBeenCalled();
    expect(updates.at(-1)).toMatchObject({ deliveryStatus: "retrying", attemptCount: 1 });
    expect(updates.at(-1).lastError).toContain("Report not available");
  });
});
