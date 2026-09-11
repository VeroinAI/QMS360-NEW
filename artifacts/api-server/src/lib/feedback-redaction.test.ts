import { describe, expect, it } from "vitest";
import { redactFeedbackText } from "./feedback-redaction";

describe("redactFeedbackText", () => {
  it.each([
    ["password: hunter2", "password: [REDACTED]"],
    ["passcode = 2468", "passcode = [REDACTED]"],
    ["PIN: \"1234\"", "PIN: [REDACTED]"],
    ["secret_key: abc-def", "secret_key: [REDACTED]"],
    ["API key = sk-live-example", "API key = [REDACTED]"],
    ["token: bearer-token-123.", "token: [REDACTED]"],
  ])("redacts %s", (input, expected) => {
    expect(redactFeedbackText(input)).toBe(expected);
  });

  it("redacts multiple assignments without changing surrounding feedback", () => {
    expect(redactFeedbackText("Login failed. password=hunter2; token: abc123. Please investigate."))
      .toBe("Login failed. password= [REDACTED]; token: [REDACTED] Please investigate.");
  });

  it("does not redact ordinary prose or credential labels without values", () => {
    expect(redactFeedbackText("I forgot my password and the password reset page is unavailable.")).toBe(
      "I forgot my password and the password reset page is unavailable.",
    );
    expect(redactFeedbackText("The secret is not shown on this page.")).toBe(
      "The secret is not shown on this page.",
    );
  });
});