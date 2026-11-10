import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ manageRoles: true, calls: [] as Array<{ name: string; params: unknown }> }));
const user = { id: "profile-user", username: "reviewer", fullName: "Example Reviewer", email: "reviewer@example.test", platformRole: "Employee", workspaceRoles: [], status: "Active", designation: "Engineer", signatureUrl: null };
vi.mock("@workspace/api-client-react", async original => {
  const actual = await original<Record<string, unknown>>();
  return Object.fromEntries(Object.entries(actual).map(([name, value]) => [name,
    name.startsWith("use") ? (params: unknown) => {
      if (name.endsWith("Users")) state.calls.push({ name, params });
      return ({
      data: name === "useGetCurrentUser" ? { id: "admin", platformRole: "Employee" }
        : ["useListRoleAssignmentProjects", "useListLessonsDelegationPendingForms", "useListApproverScopes", "useListLessonApprovers"].includes(name) ? []
        : name === "useGetLessonsDelegationOptions" ? { projects: [], users: [] }
        : name.endsWith("Users") ? { items: [user], total: 45, page: 1, limit: 20 } : { items: [], values: [] },
      isLoading: false, error: null, refetch: vi.fn(), mutate: vi.fn(), isPending: false,
    }); } : value,
  ]));
});
vi.mock("@/lib/use-qaqc-capabilities", () => ({
  useQaqcCapabilities: () => ({ administrator: false, isLoading: false, hasAdminTasks: true, canTask: (task: string) => task === "manage_roles" ? state.manageRoles : true }),
}));
import { AdminRoutes } from "./index";
function render(app: string) {
  return renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><Router ssrPath={`/settings/${app}/access`}><AdminRoutes /></Router></QueryClientProvider>);
}
beforeEach(() => { state.manageRoles = true; state.calls = []; });
describe("Workspace user profile action", () => {
  it.each(["qaqc", "lessons", "audit"])("shows Edit profile alongside the existing %s user actions", app => {
    const html = render(app);
    expect(html).toContain("Example Reviewer");
    expect(html).toContain("Edit profile");
    expect(html).toContain("Edit email");
    expect(html).toContain("Set password");
    expect(html).not.toContain("Access request queue");
    expect(html).toContain("Delegations");
    expect(html).toContain('aria-label="User list pages"');
    expect(html).toContain('aria-label="Page 3"');
    expect(html).toContain("of 45 users");
    expect(html).toContain("Page 1 of 3");
    const name = app === "qaqc" ? "useListQaqcUsers" : app === "audit" ? "useListAuditUsers" : "useListLessonsUsers";
    expect(state.calls.find(call => call.name === name)?.params).toEqual({ page: 1, limit: 20 });
  });
  it("does not show the QA/QC profile action without role-management access", () => {
    state.manageRoles = false;
    expect(render("qaqc")).not.toContain("Edit profile");
  });
});
