import { describe, expect, it, vi } from "vitest";
import { emailReportOptions, eventsForWorkspace } from "@workspace/field-controls";
import { approvalEmailEvent, finalApprovalEmailEvents, legacyEmailEvent, qaqcReportEmailEvents } from "./approval-email-events";
import { resolveEmailRule } from "./email-rules";

vi.mock("./email-queue", () => ({ enqueueEmail: vi.fn() }));

const actions = ["create", "update", "delete", "submit", "approve", "send_back"];
const databaseFor = (rules: any[]) => ({
  select: () => ({ from: () => ({ where: () => ({ orderBy: async () => rules }) }) }),
}) as any;
const rule = (eventType: string, name: string, enabled = true) => ({
  id: name, eventType, enabled, recipientMode: "external_email", receiverEmail: `${name}@example.test`,
  recipientConfig: {
    subjectTemplate: `${name} subject`, bodyTemplate: `${name} body`,
    reportAttachments: ["qaqc_report_pdf"],
    ccRecipient: { mode: "external_email", email: `${name}-cc@example.test` },
  },
});

describe.each(["monthly", "daily"])("%s report email separation", type => {
  it.each(actions)("classifies %s without changing the domain event or record", action => {
    const event = { app: "qaqc", entityType: "qaqc_report", action,
      organizationId: "tenant", entityId: "saved-report", actorId: "actor",
      record: { reportType: type, state: action === "send_back" ? "sent_back" : "submitted" } };
    const converted = approvalEmailEvent(event);
    const eventType = `qaqc.${type}_report.${action}`;
    expect(converted).toEqual({ ...event, entityType: `${type}_report` });
    expect(event.entityType).toBe("qaqc_report");
    expect(converted.record).toBe(event.record);
    expect(qaqcReportEmailEvents[eventType]).toBeTruthy();
    expect(legacyEmailEvent(eventType)).toBe(action === "submit" ? undefined : `qaqc.qaqc_report.${action}`);
    expect(emailReportOptions(eventType)).toEqual(action === "delete" ? [] : [{
      value: "qaqc_report_pdf",
      label: type === "monthly" ? "Monthly QA/QC report (PDF)" : "Daily Submission report (PDF)",
    }, {
      value: "qaqc_dashboard_pdf",
      label: type === "monthly" ? "Monthly QA/QC dashboard (PDF)" : "Daily Submission dashboard (PDF)",
    }]);
  });

  it.each(actions)("selects only the specific %s rule, with its recipients and content", async action => {
    const shared = rule(`qaqc.qaqc_report.${action}`, "shared");
    const other = rule(`qaqc.${type === "monthly" ? "daily" : "monthly"}_report.${action}`, "other");
    const specific = rule(`qaqc.${type}_report.${action}`, type);
    const event = { app: "qaqc", entityType: `${type}_report`, action, organizationId: "tenant", actorId: "actor" };
    const result = await resolveEmailRule(databaseFor([shared, other, specific]), event);
    expect(result.rule).toBe(specific);
    expect(result.recipients).toEqual([{ email: `${type}@example.test`, name: undefined }]);
    expect(result.ccRecipients).toEqual([{ email: `${type}-cc@example.test`, name: null }]);
    expect(result.rule?.recipientConfig).toEqual(specific.recipientConfig);
  });

  it.each(actions.filter(action => action !== "submit"))("falls back to the existing shared %s rule", async action => {
    const shared = rule(`qaqc.qaqc_report.${action}`, "shared");
    const result = await resolveEmailRule(databaseFor([shared]),
      { app: "qaqc", entityType: `${type}_report`, action, organizationId: "tenant" });
    expect(result.rule).toBe(shared);
    expect(result.recipients).toHaveLength(1);
  });

  it("honors disabled specific rules rather than sending the shared email", async () => {
    const specific = rule(`qaqc.${type}_report.submit`, type, false);
    const result = await resolveEmailRule(databaseFor([rule("qaqc.qaqc_report.submit", "shared"), specific]),
      { app: "qaqc", entityType: `${type}_report`, action: "submit", organizationId: "tenant" });
    expect(result.rule).toBeNull();
    expect(result.recipients).toEqual([]);
    expect(result.ccRecipients).toEqual([]);
  });

  it("preserves actor restrictions and first-match priority within the specific event", async () => {
    const specific = rule(`qaqc.${type}_report.submit`, type);
    const restricted = { ...specific, id: "restricted", createdByUserId: "another-actor" };
    const event = { app: "qaqc", entityType: `${type}_report`, action: "submit", organizationId: "tenant", actorId: "actor" };
    expect((await resolveEmailRule(databaseFor([restricted, specific, { ...specific, id: "later" }]), event)).rule?.id).toBe(type);
    const shared = rule("qaqc.qaqc_report.submit", "shared");
    expect((await resolveEmailRule(databaseFor([restricted, shared]), event)).rule).toBeNull();
    expect((await resolveEmailRule(databaseFor([{ ...shared, createdByUserId: "another-actor" }]), event)).rule).toBeNull();
  });
});

it("keeps Monthly and Daily event catalogs separate, including final approval", () => {
  const events = Object.entries({ ...qaqcReportEmailEvents, ...finalApprovalEmailEvents }).map(([value, label]) => ({ value, label }));
  for (const [workspace, type] of [["qaqc", "monthly"], ["docgov", "daily"]] as const) {
    const visible = eventsForWorkspace(events, workspace);
    expect(visible).toHaveLength(workspace === "qaqc" ? 8 : 7);
    expect(visible.every(event => event.value.startsWith(`qaqc.${type}_report.`)
      || (workspace === "qaqc" && event.value === "qaqc.csat_report.submit"))).toBe(true);
  }
});

describe("isolated submission emails", () => {
  it("classifies CSAT submit without changing history, record, or unrelated CSAT events", () => {
    const event = { app: "qaqc", entityType: "qaqc_report", action: "submit",
      organizationId: "tenant", entityId: "survey", record: { reportType: "csat", state: "submitted" } };
    expect(approvalEmailEvent(event)).toEqual({ ...event, entityType: "csat_report" });
    expect(event.entityType).toBe("qaqc_report");
    expect(approvalEmailEvent({ ...event, action: "update" })).toEqual({ ...event, action: "update" });
    expect(emailReportOptions("qaqc.csat_report.submit")).toEqual([
      { value: "qaqc_report_pdf", label: "Customer Satisfaction (CSAT) report (PDF)" },
    ]);
    expect(qaqcReportEmailEvents["qaqc.csat_report.submit"]).toContain("CSAT");
  });

  it.each(["csat", "monthly", "daily"])("%s uses only its own submit rule", async type => {
    const rules = ["shared", "csat", "monthly", "daily"].map(name =>
      rule(`qaqc.${name === "shared" ? "qaqc" : name}_report.submit`, name));
    const event = { app: "qaqc", entityType: `${type}_report`, action: "submit", organizationId: "tenant" };
    const result = await resolveEmailRule(databaseFor(rules), event);
    expect(result.rule?.id).toBe(type);
    expect(result.recipients).toEqual([{ email: `${type}@example.test`, name: undefined }]);
    expect(result.ccRecipients).toEqual([{ email: `${type}-cc@example.test`, name: null }]);
    expect(legacyEmailEvent(`qaqc.${type}_report.submit`)).toBeUndefined();
    expect((await resolveEmailRule(databaseFor(rules.filter(item => item.id !== type)), event)).recipients).toEqual([]);
    expect((await resolveEmailRule(databaseFor([rule(`qaqc.${type}_report.submit`, type, false)]), event)).recipients).toEqual([]);
  });

  it("never dispatches a saved shared submission rule even if called directly", async () => {
    const result = await resolveEmailRule(databaseFor([rule("qaqc.qaqc_report.submit", "shared")]),
      { app: "qaqc", entityType: "qaqc_report", action: "submit", organizationId: "tenant" });
    expect(result.rule).toBeNull();
    expect(result.recipients).toEqual([]);
  });
});
