import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";

test.use({ video: "off", launchOptions: {
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
} });

function fixture(...args: string[]) {
  return execFileSync("pnpm", ["--filter", "@workspace/api-server", "exec", "tsx",
    "tests/fixtures/email-rule-browser-session.ts", ...args], { encoding: "utf8" });
}

test("administrator can select and save Audit Rescheduled with existing email controls", async ({ page }) => {
  const session = JSON.parse(fixture());
  await page.addInitScript(token => localStorage.setItem("qms360_token", token), session.token);
  const headers = { Authorization: `Bearer ${session.token}` };
  const name = `Audit Rescheduled UI ${Date.now()}`;
  let ruleId: string | undefined;
  try {
    await page.goto("/cockpit");
    await page.getByRole("tab", { name: "Email rules", exact: true }).click();
    await page.getByRole("button", { name: "New rule", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByPlaceholder("e.g. Finance team escalations").fill(name);
    const events = dialog.locator("select").first();
    await expect(events.locator('option[value="audit.audit_schedule.reschedule_audit"]')).toHaveCount(1);
    await expect(events.locator('option[value="audit.audit_schedule.reschedule_audit"]')).toContainText("Audit Rescheduled");
    await events.selectOption("audit.audit_schedule.reschedule_audit");
    await expect(dialog.getByText("Action (Then send to)", { exact: true })).toBeVisible();
    // Keep the default To mode (all active users). No audit is rescheduled in
    // this UI check, so creating the rule cannot send test mail.
    const savedResponse = page.waitForResponse(response =>
      response.url().endsWith("/api/email-rules") && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "Create rule", exact: true }).click();
    const saved = await savedResponse;
    expect(saved.status()).toBe(201);
    const rule = await saved.json();
    ruleId = rule.id;
    expect(rule.eventType).toBe("audit.audit_schedule.reschedule_audit");
    expect(rule.enabled).toBe(true);
    expect(rule.recipientMode).toBe("all_users");
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: name })).toContainText("audit.audit_schedule.reschedule_audit");
    await page.reload();
    await page.getByRole("tab", { name: "Email rules", exact: true }).click();
    await expect(page.getByRole("row").filter({ hasText: name })).toBeVisible();
  } finally {
    // Cleanup even when a post-save browser assertion fails.
    if (!ruleId) {
      const rules = await page.request.get("/api/email-rules", { headers });
      if (rules.ok()) ruleId = (await rules.json()).find((rule: { name: string }) => rule.name === name)?.id;
    }
    if (ruleId) {
      const removed = await page.request.delete(`/api/email-rules/${ruleId}`, { headers });
      expect(removed.status()).toBe(204);
    }
    fixture("cleanup", session.organizationId);
  }
});
