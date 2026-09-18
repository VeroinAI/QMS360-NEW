import { describe, expect, it } from "vitest";
import {
  buildDigestQueueRows,
  greatestReachedLessonRule,
  isLessonsDigestDue,
  nextLessonsDigestRun,
  selectSubmittedForms,
  type LessonsDigestJob,
} from "../src/lib/lessons-escalation-digest";
import { businessDaysElapsed } from "../src/lib/escalation";

const base: LessonsDigestJob = {
  enabled: true, reportKey: "pending_lessons_approval", frequency: "daily",
  time: "09:00", weeklyDay: 1, monthlyDay: 15, customIntervalMinutes: 60,
};

describe("Lessons escalation digest selection and scheduling", () => {
  it("selects only forms whose workflow state is exactly submitted", () => {
    const forms = [{ workflowState: "submitted" }, { workflowState: "approved" }, { workflowState: "sent_back" }, { workflowState: "draft" }];
    expect(selectSubmittedForms(forms)).toEqual([{ workflowState: "submitted" }]);
  });

  it("uses submittedAt, not createdAt, as the ageing anchor", () => {
    const submittedAt = new Date("2025-01-01T00:00:00Z");
    const createdAt = new Date("2024-01-01T00:00:00Z");
    const ageFromSubmittedAt = Math.floor((new Date("2025-01-03T00:00:00Z").getTime() - submittedAt.getTime()) / 86_400_000);
    const ageFromCreatedAt = Math.floor((new Date("2025-01-03T00:00:00Z").getTime() - createdAt.getTime()) / 86_400_000);
    expect(ageFromSubmittedAt).toBe(2);
    expect(ageFromCreatedAt).toBeGreaterThan(ageFromSubmittedAt);
  });

  it("ages by tenant-local dates and honors local holidays across DST", () => {
    const calendar = { workingDays: [0, 1, 2, 3, 4], holidays: ["2025-01-02"] };
    expect(businessDaysElapsed(new Date("2025-01-02T00:30:00Z"), new Date("2025-01-02T07:30:00Z"), calendar, "America/Los_Angeles")).toBe(0);
    expect(businessDaysElapsed(new Date("2025-03-07T17:00:00Z"), new Date("2025-03-11T17:00:00Z"), { workingDays: [1, 2, 3, 4, 5], holidays: [] }, "America/Los_Angeles")).toBe(2);
    expect(businessDaysElapsed(new Date("2025-01-08T12:00:00Z"), new Date("2025-01-10T12:00:00Z"), { workingDays: [1, 2, 3, 4, 5], holidays: [] }, "UTC")).toBe(2);
    expect(businessDaysElapsed(new Date("2025-01-08T12:00:00Z"), new Date("2025-01-10T12:00:00Z"), { workingDays: [1, 2, 3, 4, 5], holidays: ["2025-01-09"] }, "UTC")).toBe(1);
  });

  it("selects the greatest reached threshold", () => {
    const rules = [{ id: "l1", slaWorkingDays: 2 }, { id: "l2", slaWorkingDays: 5 }, { id: "l3", slaWorkingDays: 10 }];
    expect(greatestReachedLessonRule(rules, 7)?.id).toBe("l2");
  });

  it("keeps CC on the first primary queue row only", () => {
    const rows = buildDigestQueueRows(
      [{ email: "to-a@example.test" }, { email: "to-b@example.test" }],
      [{ email: "cc@example.test" }, { email: "to-a@example.test" }],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!.cc).toEqual([{ email: "cc@example.test" }]);
    expect(rows[1]!.cc).toEqual([]);
  });

  it("does not queue disabled or not-due schedules", () => {
    const now = new Date("2025-01-01T00:00:00Z");
    expect(isLessonsDigestDue({ ...base, enabled: false, nextRunAt: "2024-12-31T00:00:00Z" }, now)).toBe(false);
    expect(isLessonsDigestDue({ ...base, nextRunAt: "2025-01-01T01:00:00Z" }, now)).toBe(false);
    expect(isLessonsDigestDue({ ...base, nextRunAt: "2024-12-31T23:00:00Z" }, now)).toBe(true);
  });

  it.each([
    ["custom", 60, "2025-01-01T01:00:00.000Z"],
    ["daily", undefined, "2025-01-01T09:00:00.000Z"],
    ["weekly", undefined, "2025-01-06T09:00:00.000Z"],
    ["monthly", undefined, "2025-01-15T09:00:00.000Z"],
  ] as const)("calculates %s next run", (frequency, interval, expected) => {
    const job = { ...base, frequency, ...(interval ? { customIntervalMinutes: interval } : {}) };
    expect(nextLessonsDigestRun(new Date("2025-01-01T00:00:00Z"), job, "UTC").toISOString()).toBe(expected);
  });

  it("falls back to the last calendar day for monthly day 31", () => {
    const job = { ...base, frequency: "monthly" as const, monthlyDay: 31 };
    expect(nextLessonsDigestRun(new Date("2025-01-31T10:00:00Z"), job, "UTC").toISOString()).toBe("2025-02-28T09:00:00.000Z");
    expect(nextLessonsDigestRun(new Date("2024-01-31T10:00:00Z"), job, "UTC").toISOString()).toBe("2024-02-29T09:00:00.000Z");
  });
});