import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps, PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";
import { CarRegister } from "./car-register";

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
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));
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
