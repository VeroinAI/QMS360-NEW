import { beforeEach, describe, expect, it, vi } from "vitest";
const dispatch = vi.hoisted(() => vi.fn().mockResolvedValue({ recipients: [] }));
vi.mock("./email-rules", () => ({ dispatchEmailRule: dispatch }));
import { writeAuditLog } from "./workspace";

describe("Approval email dispatch from saved workflow writes", () => {
  beforeEach(() => vi.clearAllMocks());
  it.each([
    ["qaqc", "qaqc_report", "approve", { reportType: "monthly", state: "approved" }, "monthly_report", "approved_final"],
    ["qaqc", "qaqc_report", "approve", { reportType: "daily", state: "approved" }, "daily_report", "approved_final"],
    ["audit", "audit", "approve_report", { status: JSON.stringify({ reportApproval: { status: "Approved" } }) }, "audit", "approved_final"],
    ["audit", "corrective_action_report", "accept", { workflowState: "closed" }, "corrective_action_report", "approved_final"],
    ["audit", "corrective_action_report", "approve_extension", { extensionStatus: "approved" }, "corrective_action_report", "approved_final_extension"],
  ] as const)("dispatches exactly one final event for %s.%s.%s while retaining audit history", async (app, entityType, action, after, emailEntity, emailAction) => {
    const values = vi.fn().mockResolvedValue(undefined);
    await writeAuditLog({ insert: () => ({ values }) }, app, {
      organizationId: "tenant", actorId: "reviewer", entityId: "record", entityType, action, after,
    });
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ entityType, action, after }));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "tenant", entityId: "record", entityType: emailEntity, action: emailAction,
    }), expect.anything());
  });
  it("does not duplicate the protected programme/schedule approval queue", async () => {
    for (const entityType of ["audit_programme", "audit_schedule"]) {
      await writeAuditLog({ insert: () => ({ values: vi.fn() }) }, "audit", {
        organizationId: "tenant", entityType, action: "approved_final",
      });
    }
    expect(dispatch).not.toHaveBeenCalled();
  });
  it("does not dispatch if saving audit history fails", async () => {
    await expect(writeAuditLog({ insert: () => ({ values: vi.fn().mockRejectedValue(new Error("save failed")) }) }, "qaqc", {
      organizationId: "tenant", entityType: "qaqc_report", action: "approve", after: { state: "approved", reportType: "daily" },
    })).rejects.toThrow("save failed");
    expect(dispatch).not.toHaveBeenCalled();
  });
});
