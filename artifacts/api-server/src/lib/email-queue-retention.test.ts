import { beforeEach, describe, expect, it, vi } from "vitest";

const { removeEmailPdfAttachment, warn } = vi.hoisted(() => ({
  removeEmailPdfAttachment: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {},
  organizationSettings: { organizationId: "settings.org", deletedAt: "settings.deletedAt", emailDeliveryPolicy: "settings.policy" },
  outboundEmails: {
    id: "emails.id",
    context: "emails.context",
    organizationId: "emails.organizationId",
    deliveryStatus: "emails.deliveryStatus",
    updatedAt: "emails.updatedAt",
    deletedAt: "emails.deletedAt",
  },
  users: {},
}));
vi.mock("drizzle-orm", () => ({
  and: vi.fn(), eq: vi.fn(), inArray: vi.fn(), isNull: vi.fn(), lt: vi.fn(), lte: vi.fn(), or: vi.fn(),
  sql: vi.fn(),
}));
vi.mock("./email", () => ({ deliverEmail: vi.fn() }));
vi.mock("./email-attachments", () => ({ removeEmailPdfAttachment }));
vi.mock("./logger", () => ({ logger: { warn: (message: string) => warn(message), error: vi.fn() } }));

import { purgeExpiredEmailLogs } from "./email-queue";

type QueueRow = { id: string; context: Record<string, unknown> };

function createDatabase(expiredRows: QueueRow[], referencedRows: QueueRow[]) {
  const deleteWhere = vi.fn(async () => undefined);
  let selectCall = 0;
  const query = (rows: unknown[]) => ({
    from: () => ({
      where: () => Object.assign(Promise.resolve(rows), { limit: async () => rows }),
    }),
  });
  const database = {
    selectDistinct: () => query([{ organizationId: "org" }]),
    select: (projection: Record<string, unknown>) => {
      if ("policy" in projection) return query([{ policy: { retentionDays: 1 } }]);
      selectCall++;
      return query(selectCall === 1 ? expiredRows : referencedRows);
    },
    delete: () => ({ where: deleteWhere }),
  };
  return { database, deleteWhere };
}

describe("outbound email attachment retention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retains expired queue metadata if deleting the private object fails", async () => {
    const attachment = { objectPath: "/private/email-attachments/org/rec/uuid.pdf" };
    const row = { id: "old-row", context: { emailAttachments: [attachment] } };
    const { database, deleteWhere } = createDatabase([row], [row]);
    removeEmailPdfAttachment.mockRejectedValueOnce(new Error("provider detail must not be logged"));

    await purgeExpiredEmailLogs(database as never);

    expect(removeEmailPdfAttachment).toHaveBeenCalledWith("org", attachment.objectPath);
    expect(deleteWhere).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("Email PDF attachment cleanup failed; retaining queue metadata for retry");
  });

  it("keeps a shared PDF while another non-deleted queue row references it", async () => {
    const attachment = { objectPath: "/private/email-attachments/org/rec/uuid.pdf" };
    const expired = { id: "old-row", context: { emailAttachments: [attachment] } };
    const active = { id: "active-row", context: { emailAttachments: [attachment] } };
    const { database, deleteWhere } = createDatabase([expired], [expired, active]);

    await purgeExpiredEmailLogs(database as never);

    expect(removeEmailPdfAttachment).not.toHaveBeenCalled();
    expect(deleteWhere).toHaveBeenCalledOnce();
  });

  it("removes a shared attachment once after all expired recipient rows are ready to purge", async () => {
    const attachment = { objectPath: "/private/email-attachments/org/rec/uuid.pdf" };
    const first = { id: "old-row-1", context: { emailAttachments: [attachment] } };
    const second = { id: "old-row-2", context: { emailAttachments: [attachment] } };
    const { database, deleteWhere } = createDatabase([first, second], [first, second]);

    await purgeExpiredEmailLogs(database as never);

    expect(removeEmailPdfAttachment).toHaveBeenCalledOnce();
    expect(deleteWhere).toHaveBeenCalledOnce();
  });
});