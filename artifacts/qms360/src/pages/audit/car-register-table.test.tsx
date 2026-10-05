import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CarRegisterEntry, CorrectiveActionReport } from "@workspace/api-client-react";
import { CAR_REGISTER_COLUMNS, CarRegisterTable } from "./car-register-table";

const entry: CarRegisterEntry = {
  id: "finding-1", auditId: "audit-1", itemId: "item-1", auditTitle: "Audit title", scheduleName: "Schedule",
  auditTypes: ["Quality Internal Process Audit"], department: "Quality Department", projectName: "Project",
  clause: "1", auditArea: "Area", description: "Finding description", classification: "Minor NC",
  actionTakerName: "Assigned action taker", evidenceIds: [], status: "Open", canRespond: true, canReview: false,
};
const render = (entries: CarRegisterEntry[], busy = false) => renderToStaticMarkup(<CarRegisterTable
  entries={entries} page={1} limit={10} busy={busy} renderEvidence={() => <span>Evidence link</span>}
  onEdit={() => {}} onDisplay={() => {}} onReview={() => {}} onLog={() => {}} />);
const button = (html: string, id: string) => html.match(new RegExp(`<button[^>]*data-testid="${id}"[^>]*>`))?.[0] ?? "";
const car = (status: CorrectiveActionReport["status"], correctiveAction?: string) => ({
  id: "car-1", findingId: "finding-1", responsibleDepartment: "Area", ownerId: "user-1", dueDate: "2026-10-05", status, correctiveAction,
});

describe("Excel-style CAR Register", () => {
  it("matches all 14 workbook columns in order, with no extra columns", () => {
    expect(CAR_REGISTER_COLUMNS).toEqual([
      "Audit Schedule", "Audit Title", "Audit Type", "Project / Department", "Audit Area", "Description",
      "Audit Findings", "Evidence", "Action Taker", "Corrective Action Taken", "Edit", "Display", "Close / Resent CAR", "Log",
    ]);
    const html = render([entry]);
    const headers = [...html.matchAll(/<th\b[^>]*>([^<]*)<\/th>/g)].map(match => match[1]);
    expect(headers).toEqual([...CAR_REGISTER_COLUMNS]);
    expect(html).toContain("Quality Department");
    expect(html).not.toContain(">Project<");
    expect(html).toContain("Evidence link");
    expect(button(html, "button-respond-finding-1")).not.toContain('disabled=""'); // new CAR can still start
    expect(button(html, "button-review-finding-1")).toContain('disabled=""');
    expect(html).not.toContain("icon-action-taken-finding-1");
  });
  it("shows a green tick only for recorded corrective action", () => {
    expect(render([{ ...entry, car: car("Draft", "Action recorded") }])).toContain('aria-label="Corrective action taken"');
    expect(render([{ ...entry, car: { ...car("Draft", "  "), rootCause: "Root cause only" } }])).not.toContain("icon-action-taken");
  });
  it("keeps edit and review permissions and lifecycle guards", () => {
    for (const row of [
      { ...entry, canRespond: false }, { ...entry, legacy: true }, { ...entry, car: car("Closed"), status: "Closed" },
      { ...entry, car: car("Submitted"), status: "Submitted" },
    ]) expect(button(render([row]), "button-respond-finding-1")).toContain('disabled=""');
    expect(button(render([entry], true), "button-respond-finding-1")).toContain('disabled=""');
    const submitted = { ...entry, car: car("Submitted"), status: "Submitted", canReview: true };
    expect(button(render([submitted]), "button-review-finding-1")).not.toContain('disabled=""');
    expect(button(render([{ ...submitted, canReview: false }]), "button-review-finding-1")).toContain('disabled=""');
    expect(button(render([{ ...entry, canRespond: false }]), "button-display-finding-1")).not.toContain('disabled=""');
    expect(button(render([{ ...entry, canRespond: false }]), "button-log-finding-1")).not.toContain('disabled=""');
  });
  it("retains headers and an accessible empty row", () => {
    expect(render([])).toMatch(/colspan="14"/i);
    expect(render([])).toContain("No findings match these filters.");
  });
});
