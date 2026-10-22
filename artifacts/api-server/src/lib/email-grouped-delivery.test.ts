import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, integrationConnectors, organizationSettings, outboundEmails, users } from "@workspace/db";

const { sendMail, close, loadAttachments } = vi.hoisted(() => ({
  sendMail: vi.fn(), close: vi.fn(), loadAttachments: vi.fn(),
}));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail, close }) } }));
vi.mock("node:dns", () => ({ promises: { lookup: async () => [{ address: "8.8.8.8", family: 4 }] } }));
vi.mock("./email-attachments", () => ({
  loadEmailPdfAttachments: loadAttachments, removeEmailPdfAttachment: vi.fn(),
}));
vi.mock("./email-placeholder-values", () => ({
  prepareCustomPlaceholderValues: async () => () => ({}),
}));

import { deliverEmail, type EmailDeliveryInput } from "./email";
import { enqueueEmail, queuedToRecipients, runEmailQueueSweep } from "./email-queue";

const to = [
  { email: "one@example.test", name: "Person One" },
  { email: "two@example.test", name: "Person Two" },
];
const cc = [{ email: "copy@example.test", name: "Copy Person" }];
const input: EmailDeliveryInput = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  recipientIds: [], recipients: to, ccRecipients: cc,
  subject: "Approval notification", text: "Reviewed", sender: { email: "reply@example.test" },
};

function fixture(row?: Record<string, any>) {
  const inserts: Array<{ table: unknown; values: any }> = [];
  const connector = {
    id: "connector", isEnabled: true, configuration: {
      host: "smtp.example.test", fromAddress: "system@example.test", fromName: "QMS360", status: "Connected",
    },
  };
  const query = (rows: any[]) => ({
    where: () => Object.assign(Promise.resolve(rows), {
      limit: async () => rows,
      orderBy: () => ({ limit: async () => rows }),
    }),
  });
  const database = {
    select: () => ({
      from: (table: unknown) => query(table === integrationConnectors ? [connector]
        : table === organizationSettings ? [{ policy: {} }]
        : table === users ? [{ ...to[0], id: "user-one" }]
        : table === outboundEmails && row ? [{ id: row.id }] : []),
    }),
    selectDistinct: () => ({ from: () => query([]) }),
    insert: (table: unknown) => ({ values: async (values: unknown) => { inserts.push({ table, values }); } }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          if (table === outboundEmails && row) Object.assign(row, values);
          return Object.assign(Promise.resolve([]), { returning: async () => row ? [row] : [] });
        },
      }),
    }),
  } as unknown as typeof db;
  return { database, inserts };
}

describe("shared grouped email delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SMTP_ALLOWED_HOSTS", "smtp.example.test");
    loadAttachments.mockResolvedValue([]);
    sendMail.mockResolvedValue({ rejected: [] });
  });

  it.each(["lessons", "audit", "qaqc", "platform"])("queues one message for the complete %s audience", async app => {
    const { database, inserts } = fixture();
    const attachment = { filename: "form.pdf", objectPath: "/private/form.pdf", contentType: "application/pdf" as const };
    await expect(enqueueEmail(database, {
      ...input, recipientIds: ["user-one"],
      recipients: [...to, { email: "ONE@example.test", name: "Person One" }],
      ccRecipients: [...cc, ...cc, to[0]], attachments: [attachment],
      ruleTemplate: { bodyTemplate: "Dear {recipient_name}" },
      context: { app, retryEnvelopeRecipients: ["old@example.test"] },
    })).resolves.toEqual({ queued: 2 });
    const queued = inserts.find(item => item.table === outboundEmails)!.values;
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      bodyText: "Dear Person One, Person Two", ccRecipients: cc,
      context: { emailToRecipients: to, emailAttachments: [attachment] },
    });
    expect(queued[0].context).not.toHaveProperty("retryEnvelopeRecipients");
    expect(queuedToRecipients(queued[0])).toEqual(to);
  });

  it("sends one SMTP message with all To/CC names, deduplicated envelope and unchanged sender/attachments", async () => {
    const { database } = fixture();
    const attachment = { filename: "report.pdf", content: Buffer.from("fixture") };
    loadAttachments.mockResolvedValueOnce([attachment]);
    const result = await deliverEmail(database, {
      ...input, recipientIds: ["user-one"],
      recipients: [...to, { email: "ONE@example.test", name: "Person One" }],
      ccRecipients: [...cc, ...cc, to[0]],
    });
    expect(result).toMatchObject({ attempted: true, failed: 0 });
    expect(sendMail).toHaveBeenCalledOnce();
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: '"QMS360" <system@example.test>', replyTo: "reply@example.test",
      to: to.map(person => ({ name: person.name, address: person.email })),
      cc: cc.map(person => ({ name: person.name, address: person.email })),
      envelope: { from: "system@example.test", to: [to[0].email, to[1].email, cc[0].email] },
      attachments: [attachment],
    }));
    expect(close).toHaveBeenCalledOnce();
  });

  it("retries only rejected CC addresses and preserves all original MIME recipients", async () => {
    const row = {
      id: "queued", organizationId: input.organizationId,
      recipientEmail: to[0].email, recipientName: to[0].name, ccRecipients: cc,
      senderEmail: "reply@example.test", senderName: null,
      subject: input.subject, bodyText: input.text, bodyHtml: null,
      context: { emailToRecipients: to }, attemptCount: 0, maxAttempts: 4,
    };
    const { database } = fixture(row);
    sendMail.mockResolvedValueOnce({ rejected: [cc[0].email] });
    await runEmailQueueSweep(database);
    expect(row).toMatchObject({ deliveryStatus: "retrying", context: { retryEnvelopeRecipients: [cc[0].email] } });
    await runEmailQueueSweep(database);
    expect(row).toMatchObject({ deliveryStatus: "sent", attemptCount: 2 });
    expect(sendMail).toHaveBeenCalledTimes(2);
    const first = sendMail.mock.calls[0][0], retry = sendMail.mock.calls[1][0];
    expect(retry.to).toEqual(first.to);
    expect(retry.cc).toEqual(first.cc);
    expect(retry.envelope.to).toEqual([cc[0].email]);
  });

  it("retains the rejected-only envelope after a temporary retry failure", async () => {
    const { database, inserts } = fixture();
    sendMail.mockRejectedValueOnce(new Error("Temporary SMTP failure"));
    const result = await deliverEmail(database, { ...input, envelopeRecipients: [to[1].email] });
    expect(result).toMatchObject({ attempted: true, failed: 1 });
    expect(inserts[0].values.errorQueue[0]).toMatchObject({
      recipients: to, ccRecipients: cc, envelopeRecipients: [to[1].email],
    });
  });

  it("keeps legacy scalar-recipient queue items deliverable", () => {
    expect(queuedToRecipients({ recipientEmail: to[0].email, recipientName: to[0].name, context: {} })).toEqual([to[0]]);
  });

  it("does not enqueue an empty audience", async () => {
    const { database, inserts } = fixture();
    expect(await enqueueEmail(database, { ...input, recipients: [] })).toEqual({ queued: 0 });
    expect(inserts).toHaveLength(0);
  });
});
