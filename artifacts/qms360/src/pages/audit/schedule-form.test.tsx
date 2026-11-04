// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AuditSchedule } from "@workspace/api-client-react";
import { ScheduleForm } from "./index";
import { formatDate } from "@workspace/spreadsheet-dates";

const mocks = vi.hoisted(() => ({
  create: vi.fn(), update: vi.fn(), lookup: vi.fn(() => { throw new Error("Removed lookup must not run"); }),
  canEdit: true, toast: vi.fn(),
}));
vi.mock("@workspace/api-client-react", async importOriginal => ({
  ...await importOriginal<typeof import("@workspace/api-client-react")>(),
  useCreateAuditSchedule: () => ({ mutateAsync: mocks.create, isPending: false }),
  useUpdateAuditSchedule: () => ({ mutateAsync: mocks.update, isPending: false }),
  useGetAuditScheduleActivityOptions: mocks.lookup,
  useListAuditProcessProductOwners: () => ({ data: [{ fullName: "Owner" }] }),
  useListPlatformProjects: () => ({ data: { items: [{ id: "project", name: "Project" }] } }),
}));
vi.mock("@/lib/use-audit-capabilities", () => ({ useAuditCapabilities: () => ({ can: () => mocks.canEdit }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/lib/field-controls", () => ({
  useFieldControls: () => ({
    fieldProps: () => ({ disabled: false, required: false }),
    // Historical settings for the removed field must not block creation.
    mandatoryFieldKeys: () => ["activityRoleAssignments"],
  }),
}));
vi.mock("./schedule-query-refresh", () => ({ refreshAuditScheduleQueries: vi.fn() }));
vi.mock("@/lib/use-lov", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/use-lov")>(),
  useLov: (code: string) => ({ options: ({
    audit_types: [{ value: "Quality Internal Product Audit", label: "Quality Internal Product Audit" }],
    audit_categories: [{ value: "Project", label: "Project" }],
    departments: [],
  } as Record<string, { value: string; label: string }[]>)[code] ?? [] }),
}));
// Use native selects to exercise the form's selection callbacks without portal mechanics.
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, disabled, children }: any) =>
    <select value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}><option value="">Select</option>{children}</select>,
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));

const saved = {
  id: "saved", year: 2026, title: "Existing audit", projectIds: ["project"],
  auditTypes: ["Quality Internal Product Audit"], auditCategory: "Project",
  departmentProject: "Project", processProductOwner: "Owner",
  plannedStartDate: "2026-10-01", plannedEndDate: "2026-10-02",
  workflowState: "Draft", activityRoleAssignments: [{ roleId: "old-role", userIds: ["unavailable-user"] }],
} as AuditSchedule;
function show(initial?: AuditSchedule) {
  return render(<QueryClientProvider client={new QueryClient()}>
    <ScheduleForm initial={initial} onClose={vi.fn()} parentId="programme"/>
  </QueryClientProvider>);
}
function expectNoAssignments() {
  expect(screen.queryByText(/Activity roles and auditee assignments/i)).toBeNull();
  expect(screen.queryByText(/defaults for activity auditees/i)).toBeNull();
  expect(screen.queryByRole("button", { name: /Add activity role|Remove role assignment/ })).toBeNull();
  expect(screen.queryByText(/activity roles and users|eligible activity users|retained activity users/i)).toBeNull();
  expect(document.querySelector("#schedule-activityRoleAssignments")).toBeNull();
  expect(screen.getByText("12. Remarks")).toBeTruthy();
  expect(mocks.lookup).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.canEdit = true;
  mocks.create.mockResolvedValue({}); mocks.update.mockResolvedValue({});
});
afterEach(cleanup);
describe("Individual Audit form without activity assignments", () => {
  it("creates without assignments or a section-specific eligibility dependency", async () => {
    const { container } = show();
    expectNoAssignments();
    const change = (selector: string, value: string) =>
      fireEvent.change(container.querySelector(selector)!, { target: { value } });
    change("#schedule-auditTypes select", "Quality Internal Product Audit");
    change("#schedule-auditCategory select", "Project");
    change("#schedule-departmentProject select", "project");
    change("#schedule-title input", "New audit");
    change("#schedule-processProductOwner select", "Owner");
    change('#schedule-plannedStartDate input[type="text"]', formatDate("2026-10-01"));
    fireEvent.blur(container.querySelector('#schedule-plannedStartDate input[type="text"]')!);
    change('#schedule-plannedEndDate input[type="text"]', formatDate("2026-10-02"));
    fireEvent.blur(container.querySelector('#schedule-plannedEndDate input[type="text"]')!);
    expect(screen.queryAllByRole("alert").map(node => node.textContent)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Save audit" }));
    expect(screen.queryAllByRole("alert").map(node => node.textContent)).toEqual([]);
    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({ title: "New audit", parentId: "programme" });
    expect(mocks.create.mock.calls[0][0].data).not.toHaveProperty("activityRoleAssignments");
    expectNoAssignments();
  });
  it("reopens and saves unrelated changes without sending hidden historical assignments", async () => {
    const { container } = show(saved);
    expectNoAssignments();
    fireEvent.change(container.querySelector("#schedule-title input")!, { target: { value: "Renamed audit" } });
    fireEvent.click(screen.getByRole("button", { name: "Save audit" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
    expect(mocks.update.mock.calls[0][0]).toMatchObject({ id: saved.id, data: { title: "Renamed audit" } });
    expect(mocks.update.mock.calls[0][0].data).not.toHaveProperty("activityRoleAssignments");
    expect(saved.activityRoleAssignments).toEqual([{ roleId: "old-role", userIds: ["unavailable-user"] }]);
  });
  it("does not restore the section in the shared read-only form", () => {
    mocks.canEdit = false;
    const { container } = show(saved);
    expectNoAssignments();
    expect((container.querySelector("#schedule-title input") as HTMLInputElement).disabled).toBe(true);
  });
});
