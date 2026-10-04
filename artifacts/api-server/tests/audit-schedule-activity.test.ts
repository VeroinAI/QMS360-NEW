import { describe, expect, it } from "vitest";
import { scheduleActivityEntry } from "../src/lib/audit-schedule-activity";
const event = {
  id: "event", actorId: "actor", entityType: "audit_schedule", entityId: "record",
  action: "update", createdAt: new Date("2026-10-04T12:34:56Z"),
};
describe("Schedule audit activity projection", () => {
  it("shows business changes without private snapshots and preserves actor identity", () => {
    const row = scheduleActivityEntry({ ...event,
      before: { title: "Before", workflowState: "draft", status: JSON.stringify({ location: "Old" }) },
      after: { title: "After", workflowState: "submitted", signature: "PRIVATE_SIGNATURE", objectPath: "PRIVATE_PATH",
        _requestIp: "PRIVATE_IP", _auditContext: { actorName: "Name at event", requestId: "request" },
        status: JSON.stringify({ location: "New", approvalRoles: [{ name: "L1 approver" }], approvalIndex: 0 }) },
    }, "Renamed user");
    expect(row.actorName).toBe("Name at event");
    expect(row.occurredAt).toBe("2026-10-04T12:34:56.000Z");
    expect(row.status).toBe("submitted — L1 approver");
    expect(row.changes).toContainEqual({ field: "location", label: "Location", before: "Old", after: "New" });
    expect(JSON.stringify(row)).not.toMatch(/PRIVATE_/);
  });
  it("does not fabricate cleared fields for historical delete events", () => {
    const row = scheduleActivityEntry({ ...event, action: "delete",
      before: { title: "Deleted child", workflowState: "draft" },
      after: { _requestIp: "private", _auditContext: { actorName: "Actor" } },
    });
    expect(row.changes).toEqual([]);
    expect(row.recordTitle).toBe("Deleted child");
    expect(row.previousStatus).toBe("draft");
    expect(row.status).toBe("deleted");
  });
  it("recognizes historical resubmission and does not repeat stale remarks on unrelated edits", () => {
    const row = scheduleActivityEntry({ ...event, action: "submit",
      before: { workflowState: "sent_back" }, after: { workflowState: "submitted" },
    });
    expect(row.action).toBe("resubmit");
    const update = scheduleActivityEntry({ ...event, before: {},
      after: { status: JSON.stringify({ reviewComments: "Old review" }), title: "Changed" },
    });
    expect(update.remarks).toBeNull();
  });
});