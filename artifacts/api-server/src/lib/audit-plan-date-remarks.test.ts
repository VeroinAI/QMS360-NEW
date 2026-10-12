import { describe, expect, it } from "vitest";
import { CreateAuditPlanBody, UpdateAuditPlanBody, GetAuditPlanResponse } from "@workspace/api-zod";
import { auditPlanReplayMatches } from "@workspace/field-controls";

const sample = {
  id: "00000000-0000-4000-8000-000000000001",
  scheduleId: "00000000-0000-4000-8000-000000000002",
  auditFeasible: true, auditTitle: "Audit", leadAuditorId: "lead",
  teamMemberIds: ["team"], auditeeId: "auditee", qaqcScope: "Scope",
  auditTypes: ["Internal"], auditLanguage: "English", qaqcReference: "Reference",
  startDateTime: "2026-10-12T09:00", endDateTime: "2026-10-12T17:00",
  openingMeetingDateTime: "2026-10-12T09:00", closingMeetingDateTime: "2026-10-12T17:00",
  activitySection: "General", activityRemarks: "Activity", activityAuditeeId: "auditee",
  auditPlanCirculation: "Team", status: "Draft",
};
const remarks = {
  startDateTimeRemark: "Start note", endDateTimeRemark: "End note",
  openingMeetingDateTimeRemark: "Opening note\nSecond line", closingMeetingDateTimeRemark: "Closing note",
};

describe("Audit Plan date remark contracts", () => {
  it("retains all four independent remarks on create, update and response round trips", () => {
    const created = CreateAuditPlanBody.parse({ ...sample, ...remarks });
    const saved = JSON.parse(JSON.stringify(created));
    expect(UpdateAuditPlanBody.parse(saved)).toMatchObject(remarks);
    expect(GetAuditPlanResponse.parse(saved)).toMatchObject(remarks);
  });

  it("keeps remarks optional for older clients and supports explicit clearing", () => {
    expect(CreateAuditPlanBody.parse(sample)).not.toHaveProperty("startDateTimeRemark");
    const cleared = UpdateAuditPlanBody.parse({ ...sample, ...remarks, startDateTimeRemark: "" });
    expect(cleared).toMatchObject({ ...remarks, startDateTimeRemark: "" });
  });

  it.each(Object.keys(remarks))("rejects oversized remarks for %s", key => {
    expect(CreateAuditPlanBody.safeParse({ ...sample, [key]: "x".repeat(4001) }).success).toBe(false);
  });

  it.each(Object.keys(remarks))("does not silently acknowledge different %s on a create retry", key => {
    expect(auditPlanReplayMatches({ ...sample, ...remarks }, { ...sample, ...remarks, [key]: "Changed" })).toBe(false);
    expect(auditPlanReplayMatches({ ...sample, ...remarks }, { ...sample, ...remarks })).toBe(true);
  });

  it("treats absent legacy remarks and empty remarks as equivalent on replay", () => {
    expect(auditPlanReplayMatches(sample, { ...sample, startDateTimeRemark: "", endDateTimeRemark: "",
      openingMeetingDateTimeRemark: "", closingMeetingDateTimeRemark: "" })).toBe(true);
  });
});
