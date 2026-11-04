import { expect, test } from "@playwright/test";

test("audit submission memo is reused across list/detail popups and delayed defaults", async ({ page }) => {
  const firstId = "fixture-audit-memo-160";
  const secondId = "fixture-audit-memo-160-other";
  const makeProgramme = (id: string, title: string) => ({
    id, title, fromDate: "2027-01-01", toDate: "2027-12-31", teamLeadIds: [],
    teamLeadNames: [], workflowState: "Draft", childCount: 1,
    currentApprovalRole: null, currentApproverNames: [], approvalRoles: [],
    canReview: false, canSubmit: true, canManageTeamLeads: false,
    ownerId: "fixture-user", submissionReference: null, submissionFrom: null,
    submissionTo: null, submissionSubject: null, submissionMailBody: null,
  });
  const programmes = new Map([
    [firstId, makeProgramme(firstId, "Audit Task 160 Fixture")],
    [secondId, {
      ...makeProgramme(secondId, "Audit Task 160 Second Fixture"),
      submissionFrom: "Saved fallback From", submissionTo: "Saved fallback To",
    }],
  ]);
  const mutations: Array<{ method: string; url: string; body?: Record<string, string> }> = [];
  let holdDefaults = false;
  let releaseDefaults: (() => void) | undefined;

  await page.addInitScript(() => localStorage.setItem("qms360_token", "audit-memo-ui-fixture"));
  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const json = (body: unknown) => route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify(body),
    });

    if (path === "/api/auth/me") return json({
      id: "fixture-user", fullName: "Fixture User", email: "fixture@example.test",
      platformRole: "Org Admin", workspaceRoles: [], organizationName: "Fixture Org",
    });
    if (path === "/api/platform/date-format") return json({ dateFormat: "DD/MM/YYYY" });
    if (path === "/api/platform/organization-settings") return json({});
    if (path === "/api/platform/projects") return json({ items: [], total: 0, page: 1, limit: 200 });
    if (path.startsWith("/api/platform/master-data/lov/")) return json({ values: [] });
    if (path === "/api/platform/audit-memo-defaults") {
      if (holdDefaults) await new Promise<void>(resolve => { releaseDefaults = resolve; });
      return json({ from: "Fresh Default From", to: "Fresh Default To" });
    }
    if (path === "/api/audit/capabilities") return json({
      administrator: true, keys: ["schedules.create_edit", "schedules.submit", "schedules.view_all"],
    });
    if (path === "/api/audit/notifications" || path === "/api/lessons/notifications" || path === "/api/qaqc/notifications") {
      return json({ items: [], total: 0 });
    }
    if (path === "/api/audit/my-actions" || path === "/api/audit/plans") {
      return json({ items: [], total: 0, page: 1, limit: 100 });
    }
    if (path === "/api/audit/programmes" && method === "GET") {
      return json({ items: [...programmes.values()], total: programmes.size, page: 1, limit: 20 });
    }
    if (path === "/api/audit/schedules") return json({ items: [], total: 0, page: 1, limit: 20 });

    const match = path.match(/^\/api\/audit\/programmes\/([^/]+)(?:\/(submit|review))?$/);
    if (match) {
      const programme = programmes.get(match[1]!);
      if (!programme) return route.fulfill({ status: 404, body: "not found" });
      if (method === "GET") return json(programme);
      if (method === "POST" && match[2] === "submit") {
        const data = request.postDataJSON() as { reference: string; from: string; to: string; subject: string; mailBody: string };
        mutations.push({ method, url: path, body: data });
        Object.assign(programme, {
          submissionReference: data.reference, submissionFrom: data.from, submissionTo: data.to,
          submissionSubject: data.subject, submissionMailBody: data.mailBody,
          workflowState: "Submitted", canSubmit: false, canReview: true,
          currentApprovalRole: "Fixture Review", currentApproverNames: ["Fixture Reviewer"],
        });
        return json(programme);
      }
      if (method === "POST" && match[2] === "review") {
        mutations.push({ method, url: path, body: request.postDataJSON() as Record<string, string> });
        Object.assign(programme, {
          workflowState: "Sent Back", canSubmit: true, canReview: false,
          currentApprovalRole: null, currentApproverNames: [],
        });
        return json(programme);
      }
    }
    if (method !== "GET") mutations.push({ method, url: path });
    return json({ items: [], total: 0, values: [] });
  });

  await page.goto("/audit/schedules");
  await expect(page.getByRole("heading", { name: "Audit schedules" })).toBeVisible();
  const firstRow = page.getByRole("row").filter({ hasText: "Audit Task 160 Fixture" });
  await firstRow.getByRole("button", { name: "Submit" }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Subject")).toHaveValue("Audit Task 160 Fixture");
  await expect(dialog.getByLabel("Memo")).toHaveValue("");
  await expect(dialog.getByLabel("From")).toHaveAttribute("readonly", "");
  await expect(dialog.getByLabel("To")).toHaveAttribute("readonly", "");
  await dialog.getByLabel("Reference").fill("REF-160-A");
  await dialog.getByLabel("Subject").fill("Saved subject A");
  await dialog.getByLabel("Memo").fill("Saved memo line one\nSaved memo line two");
  await dialog.getByRole("button", { name: "Yes, submit" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Yes, submit" }).click();
  await expect(firstRow).toContainText("Submitted");
  await firstRow.getByRole("button", { name: "Send back" }).click();
  await page.getByLabel("Send-back remarks *").fill("Please revise.");
  await page.getByRole("button", { name: "Yes, send back" }).click();
  await expect(firstRow).toContainText("Sent Back");

  const beforeCancel = mutations.length;
  await firstRow.getByRole("button", { name: "Resubmit" }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Reference")).toHaveValue("REF-160-A");
  await expect(dialog.getByLabel("Subject")).toHaveValue("Saved subject A");
  await expect(dialog.getByLabel("Memo")).toHaveValue("Saved memo line one\nSaved memo line two");
  await dialog.getByLabel("Subject").fill("Canceled edit");
  await dialog.getByLabel("Memo").fill("Canceled memo");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(mutations).toHaveLength(beforeCancel);

  await firstRow.getByRole("button", { name: "Resubmit" }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Subject")).toHaveValue("Saved subject A");
  await expect(dialog.getByLabel("Memo")).toHaveValue("Saved memo line one\nSaved memo line two");
  await dialog.getByLabel("Subject").fill("Latest saved subject B");
  await dialog.getByLabel("Memo").fill("Latest memo paragraph one\nLatest memo paragraph two");
  await dialog.getByRole("button", { name: "Yes, resubmit" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Yes, resubmit" }).click();
  await expect.poll(() => mutations.at(-1)?.body).toMatchObject({
    subject: "Latest saved subject B",
    mailBody: "Latest memo paragraph one\nLatest memo paragraph two",
  });
  await expect(firstRow).toContainText("Submitted");
  await firstRow.getByRole("button", { name: "Send back" }).click();
  await page.getByLabel("Send-back remarks *").fill("Please revise again.");
  await page.getByRole("button", { name: "Yes, send back" }).click();
  await expect(firstRow).toContainText("Sent Back");

  await page.getByRole("link", { name: "Audit Task 160 Fixture" }).click();
  await expect(page.getByRole("heading", { name: "Audits in schedule" })).toBeVisible();
  await page.getByRole("button", { name: "Resubmit" }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Subject")).toHaveValue("Latest saved subject B");
  await expect(dialog.getByLabel("Memo")).toHaveValue("Latest memo paragraph one\nLatest memo paragraph two");
  await expect(dialog.getByLabel("Reference")).toHaveValue("REF-160-A");
  await dialog.getByLabel("Subject").fill("Saved through detail");
  await dialog.getByLabel("Memo").fill("Detail memo\nLatest detail explanation");
  await dialog.getByRole("button", { name: "Yes, resubmit" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Yes, resubmit" }).click();
  await expect.poll(() => mutations.at(-1)?.body).toMatchObject({
    reference: "REF-160-A", subject: "Saved through detail",
    mailBody: "Detail memo\nLatest detail explanation",
  });
  await page.getByRole("button", { name: "Send back", exact: true }).click();
  await page.getByLabel("Send-back remarks *").fill("Detail send-back.");
  await page.getByRole("button", { name: "Yes, send back" }).click();
  await page.getByRole("button", { name: "Resubmit", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Subject")).toHaveValue("Saved through detail");
  await expect(dialog.getByLabel("Memo")).toHaveValue("Detail memo\nLatest detail explanation");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await page.goto("/audit/schedules");
  const secondRow = page.getByRole("row").filter({ hasText: "Audit Task 160 Second Fixture" });
  holdDefaults = true;
  await secondRow.getByRole("button", { name: "Submit" }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Loading memo defaults…")).toBeVisible();
  await expect(dialog.getByLabel("Subject")).toHaveValue("Audit Task 160 Second Fixture");
  await expect(dialog.getByLabel("Memo")).toHaveValue("");
  await expect(dialog.getByLabel("From")).toHaveValue("Saved fallback From");
  await expect(dialog.getByLabel("To")).toHaveValue("Saved fallback To");
  await dialog.getByLabel("Subject").fill("Typed while defaults load");
  await dialog.getByLabel("Memo").fill("Typed first line\nTyped second line");
  await expect.poll(() => releaseDefaults).toBeDefined();
  releaseDefaults!();
  await expect(dialog.getByLabel("From")).toHaveValue("Fresh Default From");
  await expect(dialog.getByLabel("To")).toHaveValue("Fresh Default To");
  await expect(dialog.getByLabel("Subject")).toHaveValue("Typed while defaults load");
  await expect(dialog.getByLabel("Memo")).toHaveValue("Typed first line\nTyped second line");
  await expect(dialog.getByLabel("From")).toHaveAttribute("readonly", "");
  await expect(dialog.getByLabel("To")).toHaveAttribute("readonly", "");
  await dialog.getByRole("button", { name: "Cancel" }).click();
});
