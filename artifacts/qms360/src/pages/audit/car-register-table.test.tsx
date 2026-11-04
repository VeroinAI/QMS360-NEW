import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CarRegisterEntry, CorrectiveActionReport } from "@workspace/api-client-react";
import { canEditCarEntry, CAR_REGISTER_COLUMNS, CarRegisterTable, type CarRegisterTableProps } from "./car-register-table";

const entry: CarRegisterEntry = {
  id: "finding-1", auditId: "audit-1", itemId: "item-1", auditTitle: "Audit title", scheduleName: "Schedule",
  auditTypes: ["Quality Internal Process Audit"], department: "Quality Department", projectName: "Project",
  clause: "1", auditArea: "Area", description: "Finding description", classification: "Minor NC",
  actionTakerName: "Assigned action taker", evidenceIds: [], status: "Open", canRespond: true, canReview: false,
};
const render = (entries: CarRegisterEntry[], busy = false, areaProps: Pick<CarRegisterTableProps, "auditAreaOptions" | "auditAreasLoading"> = {}) => renderToStaticMarkup(<CarRegisterTable
  {...areaProps}
  entries={entries} page={1} limit={10} busy={busy} renderEvidence={() => <span>Evidence link</span>}
  onEdit={() => {}} onOpenResponse={() => {}} onDisplay={() => {}} onReview={() => {}} onLog={() => {}} />);
const button = (html: string, id: string) => html.match(new RegExp(`<button[^>]*data-testid="${id}"[^>]*>`))?.[0] ?? "";
const car = (status: CorrectiveActionReport["status"], correctiveAction?: string) => ({
  id: "car-1", findingId: "finding-1", responsibleDepartment: "Area", ownerId: "user-1", dueDate: "2026-10-05", status, correctiveAction,
});

describe("Redesigned CAR Register table", () => {
  const cells = (html: string) => [...html.matchAll(/<td\b[^>]*>(.*?)<\/td>/gs)].map(m => m[1]);
  it("renders the 13 data columns in order plus Actions", () => {
    expect(CAR_REGISTER_COLUMNS).toEqual(["CAR Number", "Audit Title", "Finding ID", "Project/Department", "Audit Area", "Audit Finding",
      "Risk Level", "Action Taker", "Assigned Date", "Due Date", "Actual Closure Date", "CAR Status", "Pending with", "Actions"]);
    const headers = [...render([entry]).matchAll(/<th\b[^>]*>([^<]*)<\/th>/g)].map(m => m[1]);
    expect(headers).toEqual([...CAR_REGISTER_COLUMNS]);
  });
  it("uses a single focusable labelled scroll region with a purple header", () => {
    const html = render([entry]);
    const region = html.match(/<div[^>]*data-testid="table-car-register"[^>]*>/)?.[0] ?? "";
    expect(region).toContain('tabindex="0"');
    expect(region).toContain('role="region"');
    expect(region).toContain("overflow-auto");
    expect(html).toContain("bg-[hsl(268_55%_32%)]");
    expect(html.match(/tabindex="0"[^>]*role="region"/g)).toHaveLength(1);
  });
  it("moves the open-response link to the Audit Title cell", () => {
    const html = render([{ ...entry, auditTitle: "AM-1709-2106" }]);
    expect(cells(html)[1]).toContain('data-testid="link-car-audit-title-finding-1"');
    expect(cells(html)[1]).toContain('aria-haspopup="dialog"');
    expect(cells(html)[1]).toContain(">AM-1709-2106</button>");
  });
  it("shows saved finding number, risk, dates and pending with without fallbacks", () => {
    const html = render([{ ...entry, findingNumber: "F-007", riskLevel: "High", assignedAt: "2026-01-05T10:00:00Z",
      actualClosedAt: null, pendingWith: "Quality Lead", dueDate: "2026-02-05" } as never]);
    expect(html).toContain("F-007"); expect(html).toContain("High"); expect(html).toContain("Quality Lead");
    expect(html).toMatch(/data-testid="text-actual-closure-date-finding-1"[^>]*>—</);
    const blank = render([entry]);
    expect(blank).toMatch(/data-testid="text-finding-id-finding-1"[^>]*><span[^>]*>Not numbered/);
    expect(blank).toMatch(/data-testid="text-risk-level-finding-1"[^>]*>—</);
    expect(blank).toMatch(/data-testid="text-assigned-date-finding-1"[^>]*>—</);
    expect(blank).toContain("Finding Date missing or no due-date rule configured");
  });
  it("displays the master-data Audit Area label and loading text", () => {
    const html = render([{ ...entry, auditArea: "design_engg" }], false, { auditAreaOptions: [{ value: "design_engg", label: "Configured Design Label" }] });
    expect(html).toContain(">Configured Design Label</td>");
    expect(render([{ ...entry, auditArea: "design_engg" }], false, { auditAreasLoading: true })).toContain("Loading Audit Area");
  });
  it("consolidates actions, evidence disclosure and recorded cue in the Actions cell", () => {
    const html = render([{ ...entry, evidenceIds: ["e1"], car: car("Draft", "Action recorded") }]);
    const actions = cells(html)[13];
    for (const id of ["button-respond", "button-display", "button-review", "button-download-car", "button-log", "details-evidence", "icon-action-taken"])
      expect(actions).toContain(`${id}-finding-1`);
    expect(actions).toContain("Evidence link");
    expect(render([entry])).not.toContain("details-evidence");
    expect(render([{ ...entry, car: car("Draft", "  ") }])).not.toContain("icon-action-taken");
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
    for (const row of [{ ...entry, canRespond: false }, { ...entry, legacy: true }, { ...entry, car: car("Closed"), status: "Closed" }]) {
      expect(button(render([row]), "link-car-audit-title-finding-1")).not.toContain('disabled=""');
      expect(canEditCarEntry(row)).toBe(false);
    }
    expect(canEditCarEntry({ ...entry, car: car("Draft") })).toBe(true);
  });
  it("shows the number repair action only when the backend allows it", () => {
    expect(render([{ ...entry, car: car("Submitted") }])).not.toContain("button-generate-car-number");
    const wrap = (busy: boolean) => renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><CarRegisterTable
      entries={[{ ...entry, car: car("Submitted"), canNumber: true }]} page={1} limit={10} busy={busy} renderEvidence={() => null}
      onEdit={() => {}} onOpenResponse={() => {}} onDisplay={() => {}} onReview={() => {}} onLog={() => {}} /></QueryClientProvider>);
    expect(wrap(false)).toContain("Not numbered");
    expect(button(wrap(false), "button-generate-car-number-finding-1")).not.toContain('disabled=""');
    expect(button(wrap(true), "button-generate-car-number-finding-1")).toContain('disabled=""');
  });
  it("retains headers and an accessible empty row", () => {
    expect(render([])).toMatch(/colspan="14"/i);
    expect(render([])).toContain("No findings match these filters.");
  });
});
