import { beforeEach, describe, expect, it, vi } from "vitest";

const { select, enqueueEmail, removeEmailPdfAttachment, emailTemplateContext, logError } = vi.hoisted(() => ({
  select: vi.fn(),
  enqueueEmail: vi.fn(),
  removeEmailPdfAttachment: vi.fn(),
  emailTemplateContext: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@workspace/db", async importOriginal => ({
  ...await importOriginal<typeof import("@workspace/db")>(),
  db: { select },
}));
vi.mock("./email-queue", () => ({ enqueueEmail }));
vi.mock("./email-attachments", () => ({ removeEmailPdfAttachment }));
vi.mock("./email-template-context", () => ({ emailTemplateContext }));
vi.mock("./logger", () => ({ logger: { error: logError, warn: vi.fn() } }));

import { dispatchEmailRule, resolveEmailRule } from "./email-rules";

const event = {
  organizationId: "org-1", app: "lessons", entityType: "lesson_form",
  action: "submit", actorId: "creator-1", entityId: "lesson-1",
};
const attachment = {
  filename: "AGH-QAM-LL-000050.pdf",
  contentType: "application/pdf" as const,
  objectPath: "/private/email-attachments/org-1/AGH-QAM-LL-000050/snapshot.pdf",
};

function query(result: unknown) {
  const chain = {
    from: () => chain, innerJoin: () => chain, where: () => chain,
    orderBy: async () => result, limit: async () => result,
  };
  return chain;
}

function ruleAndRecipients(eventType = "lessons.lesson_form.submit", hasApprover = true) {
  select.mockReturnValueOnce(query([{
    id: "rule-1", eventType, enabled: true, recipientMode: "linked_approver",
    recipientConfig: { subjectTemplate: "Review {reference}", bodyTemplate: "Please review" },
  }]));
  select.mockReturnValueOnce(query(hasApprover ? [{
    approverEmail: "approver@example.test", approverName: "Assigned Approver", creatorId: "creator-1",
  }] : []));
  if (hasApprover) {
    select.mockReturnValueOnce(query([{ email: "creator@example.test", name: "Creator" }]));
  }
}

describe("Lessons submission email PDF", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    enqueueEmail.mockResolvedValue({ queued: 1 });
    removeEmailPdfAttachment.mockResolvedValue(undefined);
    emailTemplateContext.mockResolvedValue({ reference: "AGH-QAM-LL-000050" });
  });

  it("queues the PDF for the existing approver, preserving sender and templates", async () => {
    ruleAndRecipients();
    const generate = vi.fn().mockResolvedValue([attachment]);
    await dispatchEmailRule(event, { emailAttachments: generate });
    expect(generate).toHaveBeenCalledOnce();
    expect(enqueueEmail).toHaveBeenCalledOnce();
    expect(enqueueEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      recipients: [{ email: "approver@example.test", name: "Assigned Approver" }],
      sender: { email: "creator@example.test", name: "Creator" },
      attachments: [attachment],
      ruleTemplate: { subjectTemplate: "Review {reference}", bodyTemplate: "Please review" },
      templateValues: { reference: "AGH-QAM-LL-000050" },
      context: expect.objectContaining({ app: "lessons", eventType: "lessons.lesson_form.submit" }),
    }));
    expect(removeEmailPdfAttachment).not.toHaveBeenCalled();
  });

  it("does not generate a PDF or queue email when no enabled matching rule exists", async () => {
    select.mockReturnValueOnce(query([]));
    const generate = vi.fn();
    await dispatchEmailRule(event, { emailAttachments: generate });
    expect(generate).not.toHaveBeenCalled();
    expect(enqueueEmail).not.toHaveBeenCalled();
  });

  it("does not generate a PDF when the rule has no eligible recipients", async () => {
    ruleAndRecipients(undefined, false);
    const generate = vi.fn();
    await dispatchEmailRule(event, { emailAttachments: generate });
    expect(generate).not.toHaveBeenCalled();
    expect(enqueueEmail).not.toHaveBeenCalled();
  });

  it.each(["approve", "send_back"])("leaves Lessons %s emails attachment-free", async action => {
    ruleAndRecipients(`lessons.lesson_form.${action}`);
    const generate = vi.fn();
    await dispatchEmailRule({ ...event, action }, { emailAttachments: generate });
    expect(generate).not.toHaveBeenCalled();
    expect(enqueueEmail).toHaveBeenCalledWith(expect.anything(), expect.not.objectContaining({
      attachments: expect.anything(),
    }));
  });

  it("leaves other applications' emails unchanged", async () => {
    select.mockReturnValueOnce(query([{
      id: "other-rule", eventType: "qaqc.daily_report.submit", recipientMode: "external_email",
      receiverEmail: "quality@example.test", recipientConfig: {},
    }]));
    const generate = vi.fn();
    await dispatchEmailRule({ ...event, app: "qaqc", entityType: "daily_report" }, { emailAttachments: generate });
    expect(generate).not.toHaveBeenCalled();
    expect(enqueueEmail).toHaveBeenCalledOnce();
  });

  it("logs PDF failures and never silently sends an attachment-free submission email", async () => {
    ruleAndRecipients();
    await dispatchEmailRule(event, { emailAttachments: vi.fn().mockRejectedValue(new Error("storage unavailable")) });
    expect(enqueueEmail).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.any(Error), event,
    }), "Email event rule dispatch failed");
  });

  it.each([true, false])("cleans up an unqueued PDF when enqueue fails: %s", async fails => {
    ruleAndRecipients();
    if (fails) enqueueEmail.mockRejectedValue(new Error("queue unavailable"));
    else enqueueEmail.mockResolvedValue({ queued: 0 });
    await dispatchEmailRule(event, { emailAttachments: vi.fn().mockResolvedValue([attachment]) });
    expect(removeEmailPdfAttachment).toHaveBeenCalledWith("org-1", attachment.objectPath);
  });
});

describe("Lessons send-back email rule compatibility", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    enqueueEmail.mockResolvedValue({ queued: 1 });
    emailTemplateContext.mockResolvedValue({ review_comments: "Please correct the form" });
  });
  it.each(["lessons.lesson_form.reject", "lessons.lesson_form.send_back"])(
    "uses the saved %s subject and rich body for the real send-back event",
    async eventType => {
      const recipientConfig = {
        subjectTemplate: "Form {lessons_lesson_form_reference_number} returned for correction",
        bodyTemplate: "Dear {lessons_creator_full_name},\n{lessons_lesson_form_send_back_remarks}",
        bodyRichText: {
          type: "doc", content: [{ type: "paragraph", content: [{
            type: "text", text: "{lessons_lesson_form_send_back_remarks}", marks: [{ type: "bold" }],
          }] }],
        },
      };
      select.mockReturnValueOnce(query([{
        id: "send-back-rule", eventType, enabled: true, recipientMode: "linked_creator", recipientConfig,
      }]));
      select.mockReturnValueOnce(query([{ creatorEmail: "creator@example.test", creatorName: "Creator" }]));
      select.mockReturnValueOnce(query([{ email: "reviewer@example.test", name: "Reviewer" }]));
      const record = { id: event.entityId, reviewDecision: "send_back", reviewComments: "Please correct the form" };
      const generate = vi.fn();
      const result = await dispatchEmailRule({ ...event, action: "send_back", record }, { emailAttachments: generate });
      expect(result.rule?.id).toBe("send-back-rule");
      expect(enqueueEmail).toHaveBeenCalledOnce();
      expect(enqueueEmail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        recipients: [{ email: "creator@example.test", name: "Creator" }],
        sender: { email: "reviewer@example.test", name: "Reviewer" },
        ruleTemplate: recipientConfig,
        placeholderEvent: { eventType, entityId: event.entityId, actorId: event.actorId, record },
        templateValues: { review_comments: "Please correct the form" },
      }));
      expect(generate).not.toHaveBeenCalled();
    },
  );
  it("preserves first-matching priority and actor filtering across the two event names", async () => {
    select.mockReturnValueOnce(query([
      { id: "wrong-actor", eventType: "lessons.lesson_form.reject", createdByUserId: "other-user" },
      { id: "first-rule", eventType: "lessons.lesson_form.reject", recipientMode: "external_email", receiverEmail: "first@example.test" },
      { id: "second-rule", eventType: "lessons.lesson_form.send_back", recipientMode: "external_email", receiverEmail: "second@example.test" },
    ]));
    const result = await resolveEmailRule({ select } as any, { ...event, action: "send_back" });
    expect(result.rule?.id).toBe("first-rule");
    expect(result.recipients).toEqual([{ email: "first@example.test", name: undefined }]);
  });
  it.each([
    { app: "lessons", entityType: "lesson_form", action: "approve" },
    { app: "audit", entityType: "audit_schedule", action: "send_back" },
    { app: "qaqc", entityType: "lesson_form", action: "send_back" },
  ])("does not broaden Reject matching to $app / $entityType / $action", async differentEvent => {
    select.mockReturnValueOnce(query([{ id: "reject-rule", eventType: "lessons.lesson_form.reject" }]));
    const result = await resolveEmailRule({ select } as any, { ...event, ...differentEvent });
    expect(result.rule).toBeNull();
    expect(result.recipients).toEqual([]);
    expect(enqueueEmail).not.toHaveBeenCalled();
  });
});
