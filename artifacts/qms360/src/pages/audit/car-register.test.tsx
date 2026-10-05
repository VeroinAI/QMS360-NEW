import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps, PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";
import type { CorrectiveActionReport } from "@workspace/api-client-react";
import { CarRegister, CarResponseDialog } from "./car-register";

const { list } = vi.hoisted(() => ({
  list: vi.fn(() => ({
    data: { items: [], total: 0, page: 1, limit: 10, projects: [], schedules: [], auditTitles: [], auditTypes: [], departments: [] },
    isLoading: false, error: null,
  })),
}));
vi.mock("@workspace/api-client-react", async importOriginal => ({
  ...await importOriginal<typeof import("@workspace/api-client-react")>(),
  useListCarRegister: list,
  useStartFindingCar: () => ({ isPending: false }),
  useOpenCarEditSession: () => ({ isPending: false }),
  useUpdateCorrectiveActionReport: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useSubmitCorrectiveActionReport: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));
vi.mock("@/lib/field-controls", () => ({
  useFieldControls: () => ({ fieldProps: () => ({ disabled: false }), mandatoryFieldKeys: () => [] }),
}));
vi.mock("@/lib/use-field-access", () => ({
  useFieldAccess: () => ({ readOnly: () => false }),
}));
// Expose portal contents to verify the exact form presented by Display.
vi.mock("@/components/ui/dialog", () => {
  const Container = ({ children }: PropsWithChildren) => <div>{children}</div>;
  return Object.fromEntries(["Dialog", "DialogContent", "DialogDescription", "DialogFooter", "DialogHeader", "DialogTitle"].map(key => [key, Container]));
});
// Radix mounts options in a browser portal; expose them for this static-render check.
vi.mock("@/components/ui/select", () => {
  const Container = ({ children }: PropsWithChildren) => <div>{children}</div>;
  return {
    Select: Container,
    SelectContent: Container,
    SelectValue: () => null,
    SelectTrigger: (props: ComponentProps<"button">) => <button {...props} />,
    SelectItem: ({ children, value }: PropsWithChildren<{ value: string }>) => <span data-value={value}>{children}</span>,
  };
});

describe("CAR Response display and assignment guards", () => {
  const car: CorrectiveActionReport = {
    id: "car-1", findingId: "finding-1", ownerId: "assigned-user", responsibleDepartment: "Audit area",
    dueDate: "2026-10-05", status: "Draft", canRespond: true,
    rootCause: "Recorded root cause", correction: "Recorded correction", correctiveAction: "Recorded corrective action",
  };
  const render = (response: CorrectiveActionReport, readOnly = false) =>
    renderToStaticMarkup(<CarResponseDialog car={response} open readOnly={readOnly} onClose={() => {}} />);
  it("shows the same CAR Response fields read-only through Display, even for its Action Taker", () => {
    const html = render(car, true);
    expect(html).toContain("CAR Response");
    for (const text of [car.rootCause!, car.correction!, car.correctiveAction!]) expect(html).toContain(text);
    const inputs = html.match(/<textarea\b[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(3);
    for (const input of inputs) expect(input).toMatch(/readonly=""/i);
    expect(html).not.toContain('data-testid="button-save-car"');
    expect(html).not.toContain('data-testid="button-save-submit-car"');
    expect(html).toContain(">Close</button>");
  });
  it("does not expose editing for a different user or when permission is unknown", () => {
    for (const canRespond of [false, undefined]) {
      const html = render({ ...car, canRespond });
      expect(html).not.toContain("button-save-car");
      for (const input of html.match(/<textarea\b[^>]*>/g) ?? []) expect(input).toMatch(/readonly=""/i);
    }
  });
  it("retains editable fields and save/submit for the authorized Action Taker", () => {
    const html = render(car);
    expect(html).toContain('data-testid="button-save-car"');
    expect(html).toContain('data-testid="button-save-submit-car"');
    expect(html).not.toMatch(/readonly=""/i);
  });
});

describe("CAR Register filter controls", () => {
  it("offers All for every requested column and a clear-filters action", () => {
    const html = renderToStaticMarkup(<CarRegister />);
    for (const [id, label] of [
      ["schedule", "Audit Schedule"], ["audit-title", "Audit Title"], ["audit-type", "Audit Type"],
      ["project", "Project"], ["department", "Department"], ["status", "Status"],
    ]) {
      expect(html).toContain(`data-testid="select-car-${id}"`);
      expect(html).toContain(`aria-label="${label}"`);
    }
    for (const text of ["All audit schedules", "All audit titles", "All audit types", "All projects", "All departments", "All statuses"]) {
      expect(html).toContain(text);
    }
    expect(html).toContain('data-testid="button-clear-car-filters"');
    expect(html).toContain('data-testid="checkbox-include-legacy"');
    expect(list).toHaveBeenCalledWith(
      { page: 1, limit: 10, includeLegacy: false },
      expect.objectContaining({ query: expect.objectContaining({ refetchInterval: 20_000 }) }),
    );
  });
});
