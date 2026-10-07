import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";

const state = vi.hoisted(() => ({
  items: [] as Array<{ id: string; name: string; active: boolean; permissions: unknown[] }>,
  loading: false, error: null as Error | null,
}));
vi.mock("@workspace/api-client-react", async original => {
  const actual = await original<Record<string, unknown>>();
  return Object.fromEntries(Object.entries(actual).map(([name, value]) => [name,
    name.startsWith("use") ? () => ({
      data: { items: state.items, platformRole: "Super Admin" },
      isLoading: state.loading, error: state.error, refetch: vi.fn(), mutate: vi.fn(), isPending: false,
    }) : value,
  ]));
});
vi.mock("@/lib/use-qaqc-capabilities", () => ({
  useQaqcCapabilities: () => ({ administrator: true, isLoading: false, hasAdminTasks: true, canTask: () => true }),
}));
import { AdminRoutes } from "./index";

function render(app: string) {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <Router ssrPath={`/settings/${app}/roles`}><AdminRoutes /></Router>
    </QueryClientProvider>,
  );
}
describe("first role creation remains available", () => {
  it.each(["lessons", "qaqc", "audit"])("renders the matrix, explanation and creation button for empty %s roles", app => {
    state.items = []; state.error = null; state.loading = false;
    const html = render(app);
    expect(html).toContain("Roles &amp; permission matrix");
    expect(html).toMatch(/<button[^>]*>[\s\S]*?Custom role<\/button>/);
    expect(html).toContain("create the first role");
    expect(html).not.toContain("No records found");
  });
  it("renders the saved role and removes the first-role explanation", () => {
    state.items = [{ id: "first-role", name: "First custom role", active: true, permissions: [] }];
    const html = render("lessons");
    expect(html).toContain("First custom role");
    expect(html).not.toContain("create the first role");
  });
  it("does not render role actions while loading or after a failed request", () => {
    state.items = []; state.loading = true;
    expect(render("lessons")).not.toContain("Custom role</button>");
    state.loading = false; state.error = new Error("403 Forbidden");
    const html = render("lessons");
    expect(html).toContain("Administration is unavailable");
    expect(html).not.toContain("Custom role</button>");
    state.error = null;
  });
});
