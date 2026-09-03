import { execFileSync } from "node:child_process";
import { expect, test, type APIRequestContext, type Dialog, type Locator, type Page } from "@playwright/test";

const admin = {
  email: process.env.E2E_ADMIN_EMAIL ?? "noura.alharbi@algihaz.com",
  password: process.env.E2E_ADMIN_PASSWORD ?? "Demo1234!",
};
const restricted = { email: "audit@algihaz.demo", password: "Demo1234!" };

type Session = {
  token: string;
  user: { id: string };
};

async function createSession(request: APIRequestContext): Promise<Session> {
  const response = await request.post("/api/auth/login", { data: admin });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

async function authenticate(page: Page): Promise<Session> {
  const session = await createSession(page.request);
  await page.addInitScript((token) => localStorage.setItem("qms360_token", token), session.token);
  return session;
}

function authHeaders(session: Session) {
  return { Authorization: `Bearer ${session.token}` };
}

function field(page: Page, label: string): Locator {
  return page.getByText(label, { exact: true }).locator("..").locator("input, textarea").first();
}

async function selectFirst(page: Page, label: string) {
  const container = page.getByText(label, { exact: true }).locator("..");
  await container.getByRole("combobox").click();
  await page.getByRole("option").first().click();
}

function futureDate() {
  return "2099-12-31";
}

test.describe.serial("QMS360 critical workspace journeys", () => {
  test("login renders landing cards according to application access", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(admin.email);
    await page.getByLabel("Password").fill(admin.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "System Overview" })).toBeVisible();

    const accessResponse = await page.request.get("/api/platform/application-access", {
      headers: authHeaders({ token: await page.evaluate(() => localStorage.getItem("qms360_token")!), user: { id: "" } }),
    });
    expect(accessResponse.ok()).toBeTruthy();
    const access = await accessResponse.json() as Record<"qaqc" | "lessons" | "audit", boolean>;
    const cards = {
      qaqc: "QA/QC & Document Governance",
      lessons: "Lesson Learned",
      audit: "QMS Audit",
    } as const;

    for (const [key, title] of Object.entries(cards) as Array<[keyof typeof cards, string]>) {
      const card = page.getByText(title, { exact: true }).locator("..").locator("..");
      await expect(card).toContainText(access[key] ? "Open application" : "Application locked");
      if (!access[key]) await expect(card).toContainText("Access is not assigned to your role.");
    }

    await page.evaluate(() => localStorage.clear());
    await page.goto("/login");
    await page.getByLabel("Email").fill(restricted.email);
    await page.getByLabel("Password").fill(restricted.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    const lockedCard = page.getByText(cards.qaqc, { exact: true }).locator("..").locator("..");
    await expect(lockedCard).toContainText("Application locked");
    await expect(lockedCard).toContainText("Access is not assigned to your role.");
  });

  test("QA/QC metric create, submit, approve and MIR reconciliation guard", async ({ page }) => {
    const session = await authenticate(page);
    const refsResponse = await page.request.get("/api/lessons/reference-data", { headers: authHeaders(session) });
    expect(refsResponse.ok()).toBeTruthy();
    const refs = await refsResponse.json() as { projects: Array<{ id: string }> };
    expect(refs.projects.length).toBeGreaterThan(0);
    const projectId = refs.projects[0]!.id;
    const issued = String(700 + Math.floor(Math.random() * 200));
    const metricsResponse = await page.request.get("/api/qaqc/metrics?page=1&limit=200", { headers: authHeaders(session) });
    expect(metricsResponse.ok()).toBeTruthy();
    const metrics = await metricsResponse.json() as { items: Array<{ projectId: string; period: string; category: string }> };
    const occupied = new Set(metrics.items
      .filter((item) => item.projectId === projectId && item.category === "External NCR")
      .map((item) => item.period.slice(0, 7)));
    const period = Array.from({ length: 70 * 12 }, (_, index) => {
      const year = 2030 + Math.floor(index / 12);
      const month = String(index % 12 + 1).padStart(2, "0");
      return `${year}-${month}`;
    }).find((candidate) => !occupied.has(candidate));
    expect(period, "An unused metric reporting period must be available").toBeTruthy();

    await page.goto("/qaqc/metrics");
    await expect(page.getByRole("heading", { name: "NCR / RFI / RMI metrics" })).toBeVisible();
    await page.getByRole("button", { name: "New entry" }).click();
    await expect(page.getByRole("dialog").getByText("New quality metric")).toBeVisible();
    await field(page, "Project ID").fill(projectId);
    await field(page, "Period").fill(period!);
    await field(page, "Issued").fill(issued);
    await field(page, "Closed").fill(issued);
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Metric created", { exact: true })).toBeVisible();

    const metricRow = page.getByRole("row").filter({ hasText: projectId }).filter({ hasText: issued }).first();
    await expect(metricRow).toContainText("Draft");
    await metricRow.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText("Metric submitted", { exact: true })).toBeVisible();
    await expect(metricRow).toContainText("Submitted");
    await metricRow.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByRole("dialog").getByText("Approve metric")).toBeVisible();
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("Metric approved", { exact: true })).toBeVisible();
    await expect(metricRow).toContainText("Approved");

    await page.goto("/qaqc/material-inspections");
    await page.getByRole("button", { name: "New entry" }).click();
    const dialog = page.getByRole("dialog");
    await field(page, "Project ID").fill(projectId);
    await field(page, "Total MIRN").fill("1");
    await expect(dialog.getByText("Not reconciled: breakdown 0, total 1")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await field(page, "Approved").fill("1");
    await expect(dialog.getByText("Reconciled: breakdown equals total MIRN")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  });

  test("lesson creation, AI rephrase and send-back requires remarks", async ({ page }) => {
    const session = await authenticate(page);
    const title = `E2E lesson ${Date.now()}`;
    const improvedDescription = "Preventive maintenance was missed, causing the valve failure.";
    await page.route("**/api/lessons/ai/rephrase", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ suggestion: improvedDescription }),
    }));

    await page.goto("/lessons/new");
    await expect(page.getByRole("heading", { name: "New Lesson Learned" })).toBeVisible();
    await field(page, "Title").fill(title);
    await selectFirst(page, "Project");
    await selectFirst(page, "Discipline");
    await selectFirst(page, "Categorisation");
    await field(page, "Description").fill("The valve failed because preventive maintenance was missed.");
    await field(page, "Root cause").fill("The maintenance schedule was not followed.");
    await field(page, "Correction").fill("The valve was replaced and inspected.");
    await field(page, "Corrective action").fill("Add a weekly maintenance compliance review.");

    await page.getByText("Description", { exact: true }).locator("..").getByRole("button", { name: "Rephrase with AI" }).click();
    await expect(page.getByText("AI suggestion")).toBeVisible();
    await page.getByRole("button", { name: "Use suggestion" }).click();
    await expect(field(page, "Description")).toHaveValue(improvedDescription);

    await page.getByRole("button", { name: "Save lesson" }).click();
    await expect(page).toHaveURL(/\/lessons\/log$/);
    await page.getByPlaceholder("Search title, reference or content…").fill(title);
    const lessonResponse = page.waitForResponse((response) =>
      response.url().includes("/api/lessons/forms/") && response.request().method() === "GET" && response.ok(),
    );
    await page.getByRole("link", { name: title }).click();
    const lesson = await (await lessonResponse).json() as Record<string, unknown> & { id: string };
    const updateResponse = await page.request.put(`/api/lessons/forms/${lesson.id}`, {
      headers: authHeaders(session),
      data: { ...lesson, approverId: session.user.id },
    });
    expect(updateResponse.ok(), await updateResponse.text()).toBeTruthy();
    await page.reload();

    await page.getByRole("button", { name: "Submit for approval" }).click();
    await expect(page.getByText("Lesson submitted for approval", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send back" })).toBeVisible();
    await page.getByRole("button", { name: "Send back" }).click();
    const reviewDialog = page.getByRole("dialog");
    await expect(reviewDialog.getByText("Remarks are required so the creator knows what to change.")).toBeVisible();
    await expect(reviewDialog.getByRole("button", { name: "Confirm" })).toBeDisabled();
    await reviewDialog.getByPlaceholder("Review remarks").fill("Please add the verification evidence.");
    await expect(reviewDialog.getByRole("button", { name: "Confirm" })).toBeEnabled();
    await reviewDialog.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("Lesson sent back", { exact: true })).toBeVisible();
    await expect(page.getByText("Sent Back", { exact: true })).toBeVisible();
  });

  test("audit finding raises one CAR per department, requests extension and closes", async ({ page }) => {
    const session = await authenticate(page);
    const auditsResponse = await page.request.get("/api/audit/audits?page=1&limit=100", { headers: authHeaders(session) });
    expect(auditsResponse.ok()).toBeTruthy();
    const audits = await auditsResponse.json() as { items: Array<{ id: string }> };
    expect(audits.items.length, "Seed data must include an audit workspace").toBeGreaterThan(0);
    const auditId = audits.items[0]!.id;
    const suffix = Date.now();
    const findingTitle = `E2E NC ${suffix}`;
    const departmentA = `E2E Operations ${suffix}`;
    const departmentB = `E2E Quality ${suffix}`;

    await page.goto(`/audit/audits/${auditId}`);
    await page.getByRole("tab", { name: "Findings" }).click();
    await page.getByRole("button", { name: "New finding" }).click();
    const findingDialog = page.getByRole("dialog");
    await findingDialog.getByText("Title *").locator("..").getByRole("textbox").fill(findingTitle);
    await findingDialog.getByText("Description *").locator("..").getByRole("textbox").fill("A mandatory control was not implemented.");
    await findingDialog.getByText("Responsible departments *").locator("..").getByRole("textbox").fill(`${departmentA}, ${departmentB}`);
    await findingDialog.getByRole("combobox").nth(0).click();
    await page.getByRole("option", { name: "Major NC", exact: true }).click();
    await findingDialog.getByRole("button", { name: "Save finding" }).click();
    await expect(page.getByText("Finding saved", { exact: true })).toBeVisible();

    const findingCard = page.getByRole("heading", { name: findingTitle }).locator("..").locator("..");
    await findingCard.getByRole("button", { name: "Raise CAR" }).click();
    await expect(page.getByText("Raised 2 CAR(s)", { exact: true })).toBeVisible();

    await page.goto("/audit/cars");
    await expect(page.getByText(departmentA, { exact: true })).toBeVisible();
    await expect(page.getByText(departmentB, { exact: true })).toBeVisible();
    const car = page.getByText(departmentA, { exact: true }).locator("..").locator("..");
    await car.getByRole("button", { name: "Edit response" }).click();
    const responseDialog = page.getByRole("dialog");
    await responseDialog.getByText("Root cause", { exact: true }).locator("..").getByRole("textbox").fill("Ownership was unclear.");
    await responseDialog.getByText("Correction", { exact: true }).locator("..").getByRole("textbox").fill("The control was implemented.");
    await responseDialog.getByText("Corrective action", { exact: true }).locator("..").getByRole("textbox").fill("Assign and review control ownership monthly.");
    await responseDialog.getByRole("button", { name: "Save response" }).click();
    await expect(page.getByText("CAR updated", { exact: true })).toBeVisible();

    await car.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText("CAR submitted", { exact: true })).toBeVisible();
    await car.getByRole("button", { name: "Accept" }).click();
    await expect(page.getByText("CAR accepted", { exact: true })).toBeVisible();

    const promptAnswers = [futureDate(), "Additional time is required for effectiveness verification."];
    const answerExtensionPrompts = async (dialog: Dialog) =>
      dialog.accept(promptAnswers.shift() ?? "");
    page.on("dialog", answerExtensionPrompts);
    await car.getByRole("button", { name: "Extension" }).click();
    await expect(page.getByText("Extension requested", { exact: true })).toBeVisible();
    page.off("dialog", answerExtensionPrompts);
    await car.getByRole("button", { name: "Approve extension" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Notification Extension approved" })).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await car.getByRole("button", { name: "Close" }).click();
    await expect(page.getByText("CAR closed", { exact: true })).toBeVisible();
    await expect(car).toContainText("Closed");
  });

  test("CAR extensions cannot bypass response and review steps", async ({ page }) => {
    const session = await authenticate(page);
    const auditsResponse = await page.request.get("/api/audit/audits?page=1&limit=100", { headers: authHeaders(session) });
    const audits = await auditsResponse.json() as { items: Array<{ id: string }> };
    const auditId = audits.items[0]!.id;
    const suffix = Date.now();
    const findingTitle = `E2E Ext NC ${suffix}`;
    const department = `E2E Ext Dept ${suffix}`;

    await page.goto(`/audit/audits/${auditId}`);
    await page.getByRole("tab", { name: "Findings" }).click();
    await page.getByRole("button", { name: "New finding" }).click();
    const findingDialog = page.getByRole("dialog");
    await findingDialog.getByText("Title *").locator("..").getByRole("textbox").fill(findingTitle);
    await findingDialog.getByText("Description *").locator("..").getByRole("textbox").fill("Control gap requiring a corrective action.");
    await findingDialog.getByText("Responsible departments *").locator("..").getByRole("textbox").fill(department);
    await findingDialog.getByRole("combobox").nth(0).click();
    await page.getByRole("option", { name: "Minor NC", exact: true }).click();
    await findingDialog.getByRole("button", { name: "Save finding" }).click();
    await expect(page.getByText("Finding saved", { exact: true })).toBeVisible();
    const findingCard = page.getByRole("heading", { name: findingTitle }).locator("..").locator("..");
    await findingCard.getByRole("button", { name: "Raise CAR" }).click();
    await expect(page.getByText("Raised 1 CAR(s)", { exact: true })).toBeVisible();

    const carsResponse = await page.request.get("/api/audit/cars?page=1&limit=100&status=open", { headers: authHeaders(session) });
    const cars = await carsResponse.json() as { items: Array<{ id: string; responsibleDepartment: string }> };
    const carId = cars.items.find((x) => x.responsibleDepartment === department)!.id;

    // API: an extension request is a conflict while the CAR is still Open (pre-response).
    const earlyExtension = await page.request.post(`/api/audit/cars/${carId}/extension`, {
      headers: authHeaders(session),
      data: { requestedDueDate: futureDate(), reason: "Trying to skip the response and review steps." },
    });
    expect(earlyExtension.status()).toBe(409);

    // API: reviewing an extension is a conflict when none is awaiting review.
    const prematureReview = await page.request.post(`/api/audit/cars/${carId}/extension/review`, {
      headers: authHeaders(session),
      data: { decision: "approve" },
    });
    expect(prematureReview.status()).toBe(409);

    // Browser: the Extension action is not offered before acceptance.
    await page.goto("/audit/cars");
    const car = page.getByText(department, { exact: true }).locator("..").locator("..");
    await expect(car.getByRole("button", { name: "Extension" })).toHaveCount(0);

    // Complete the response and review steps, then request an extension (allowed).
    await car.getByRole("button", { name: "Edit response" }).click();
    const responseDialog = page.getByRole("dialog");
    await responseDialog.getByText("Root cause", { exact: true }).locator("..").getByRole("textbox").fill("Training gap.");
    await responseDialog.getByText("Correction", { exact: true }).locator("..").getByRole("textbox").fill("Retrained the team.");
    await responseDialog.getByText("Corrective action", { exact: true }).locator("..").getByRole("textbox").fill("Add training to onboarding.");
    await responseDialog.getByRole("button", { name: "Save response" }).click();
    await expect(page.getByText("CAR updated", { exact: true })).toBeVisible();
    await car.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText("CAR submitted", { exact: true })).toBeVisible();
    await car.getByRole("button", { name: "Accept" }).click();
    await expect(page.getByText("CAR accepted", { exact: true })).toBeVisible();

    const promptAnswers = [futureDate(), "Effectiveness evidence collection needs more time."];
    const answerExtensionPrompts = async (dialog: Dialog) => dialog.accept(promptAnswers.shift() ?? "");
    page.on("dialog", answerExtensionPrompts);
    await car.getByRole("button", { name: "Extension" }).click();
    await expect(page.getByText("Extension requested", { exact: true })).toBeVisible();
    page.off("dialog", answerExtensionPrompts);

    // API: a second request while one is pending is a conflict.
    const duplicateExtension = await page.request.post(`/api/audit/cars/${carId}/extension`, {
      headers: authHeaders(session),
      data: { requestedDueDate: futureDate(), reason: "Duplicate request." },
    });
    expect(duplicateExtension.status()).toBe(409);

    // Rejecting the extension restores the prior workflow state (Accepted), not Closed.
    page.once("dialog", (dialog) => dialog.accept("Extension is not justified by the evidence plan."));
    await car.getByRole("button", { name: "Reject extension" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Extension rejected" })).toBeVisible();
    await expect(car.getByRole("button", { name: "Close" })).toBeVisible();
    const afterRejection = await page.request.get("/api/audit/cars?page=1&limit=100&status=accepted", { headers: authHeaders(session) });
    const acceptedCars = await afterRejection.json() as { items: Array<{ id: string; status: string }> };
    expect(acceptedCars.items.find((x) => x.id === carId)?.status).toBe("Accepted");
  });

  test("legacy pending CAR extensions cannot be reviewed into a closable state", async ({ page }) => {
    const session = await authenticate(page);
    const auditsResponse = await page.request.get("/api/audit/audits?page=1&limit=100", { headers: authHeaders(session) });
    const audits = await auditsResponse.json() as { items: Array<{ id: string }> };
    const auditId = audits.items[0]!.id;
    const suffix = Date.now();
    const findingTitle = `E2E Legacy NC ${suffix}`;
    const department = `E2E Legacy Dept ${suffix}`;

    await page.goto(`/audit/audits/${auditId}`);
    await page.getByRole("tab", { name: "Findings" }).click();
    await page.getByRole("button", { name: "New finding" }).click();
    const findingDialog = page.getByRole("dialog");
    await findingDialog.getByText("Title *").locator("..").getByRole("textbox").fill(findingTitle);
    await findingDialog.getByText("Description *").locator("..").getByRole("textbox").fill("Control gap requiring a corrective action.");
    await findingDialog.getByText("Responsible departments *").locator("..").getByRole("textbox").fill(department);
    await findingDialog.getByRole("combobox").nth(0).click();
    await page.getByRole("option", { name: "Minor NC", exact: true }).click();
    await findingDialog.getByRole("button", { name: "Save finding" }).click();
    await expect(page.getByText("Finding saved", { exact: true })).toBeVisible();
    const findingCard = page.getByRole("heading", { name: findingTitle }).locator("..").locator("..");
    await findingCard.getByRole("button", { name: "Raise CAR" }).click();
    await expect(page.getByText("Raised 1 CAR(s)", { exact: true })).toBeVisible();

    const carsResponse = await page.request.get("/api/audit/cars?page=1&limit=100&status=open", { headers: authHeaders(session) });
    const cars = await carsResponse.json() as { items: Array<{ id: string; findingId: string; responsibleDepartment: string; status: string; dueDate: string }> };
    const car = cars.items.find((x) => x.responsibleDepartment === department)!;
    const carId = car.id;

    // Simulate a legacy row: pending extension requested before the safeguard existed, so no
    // prior state is recorded in the CAR metadata (and no request_extension audit entry).
    const sql = (statement: string) =>
      execFileSync("psql", [process.env.DATABASE_URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", statement], { stdio: "pipe" });
    sql(`UPDATE app3_audit.corrective_action_reports
         SET workflow_state = 'extension_requested', extension_status = 'requested',
             extension_requested_at = now(), extension_due_date = '${futureDate()}',
             effectiveness_notes = '{"extensionReason":"legacy request"}', updated_at = now()
         WHERE id = '${carId}'`);

    // Approving must be refused: the original state cannot be verified, so advancing the CAR
    // would let it skip the response and review steps.
    const legacyReview = await page.request.post(`/api/audit/cars/${carId}/extension/review`, {
      headers: authHeaders(session),
      data: { decision: "approve" },
    });
    expect(legacyReview.status()).toBe(409);
    const acceptedList = await page.request.get("/api/audit/cars?page=1&limit=100&status=accepted", { headers: authHeaders(session) });
    const acceptedCars = await acceptedList.json() as { items: Array<{ id: string }> };
    expect(acceptedCars.items.some((x) => x.id === carId)).toBeFalsy();

    // Withdrawing restores a safe state (Open) that still requires the full response cycle.
    const cancel = await page.request.post(`/api/audit/cars/${carId}/extension/cancel`, { headers: authHeaders(session) });
    expect(cancel.ok(), await cancel.text()).toBeTruthy();
    expect((await cancel.json()).status).toBe("Open");

    // Rows with an audit-trail snapshot but no recorded metadata prior state (pre-safeguard
    // requests) are restored from the audit trail instead of being forced to Accepted.
    const edit = await page.request.put(`/api/audit/cars/${carId}`, {
      headers: authHeaders(session),
      data: {
        id: car.id, findingId: car.findingId, responsibleDepartment: car.responsibleDepartment,
        ownerId: session.user.id, status: car.status, dueDate: car.dueDate,
        rootCause: "Training gap.", correction: "Retrained the team.", correctiveAction: "Add training to onboarding.",
      },
    });
    expect(edit.ok(), await edit.text()).toBeTruthy();
    const submitted = await page.request.post(`/api/audit/cars/${carId}/submit`, { headers: authHeaders(session) });
    expect(submitted.ok(), await submitted.text()).toBeTruthy();
    const accepted = await page.request.post(`/api/audit/cars/${carId}/review`, { headers: authHeaders(session), data: { decision: "accept" } });
    expect(accepted.ok(), await accepted.text()).toBeTruthy();
    const requested = await page.request.post(`/api/audit/cars/${carId}/extension`, {
      headers: authHeaders(session),
      data: { requestedDueDate: futureDate(), reason: "Effectiveness verification needs more time." },
    });
    expect(requested.ok(), await requested.text()).toBeTruthy();
    sql(`UPDATE app3_audit.corrective_action_reports
         SET effectiveness_notes = '{"extensionReason":"legacy request"}', updated_at = now()
         WHERE id = '${carId}'`);
    const backfilledReview = await page.request.post(`/api/audit/cars/${carId}/extension/review`, {
      headers: authHeaders(session),
      data: { decision: "approve" },
    });
    expect(backfilledReview.ok(), await backfilledReview.text()).toBeTruthy();
    expect((await backfilledReview.json()).status).toBe("Accepted");
  });
});