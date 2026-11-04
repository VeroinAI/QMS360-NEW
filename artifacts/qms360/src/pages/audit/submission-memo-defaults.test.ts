import { describe, expect, it } from "vitest";
import { submissionMemoContent, submissionMemoDefaults } from "./submission-memo-defaults";

describe("Audit Schedule saved submission content", () => {
  const schedule = { id: "schedule-a", title: "Annual Schedule" };

  it("reuses saved subject, multiline memo and reference without altering their text", () => {
    const previous = {
      ...schedule, submissionReference: "REF-001",
      submissionSubject: "  Revised subject  ", submissionMailBody: "First paragraph\n\nSecond paragraph",
    };
    expect(submissionMemoContent(previous)).toEqual({
      reference: "REF-001", subject: "  Revised subject  ", mailBody: "First paragraph\n\nSecond paragraph",
    });
  });

  it.each([undefined, null, "", " \n "])("uses first-submission fallbacks for missing legacy content: %s", value => {
    expect(submissionMemoContent({
      ...schedule, submissionSubject: value, submissionMailBody: value,
    })).toEqual({ reference: "", subject: schedule.title, mailBody: "" });
  });

  it("falls back independently for a missing subject or memo", () => {
    expect(submissionMemoContent({ ...schedule, submissionMailBody: "Saved memo" }))
      .toEqual({ reference: "", subject: schedule.title, mailBody: "Saved memo" });
    expect(submissionMemoContent({ ...schedule, submissionSubject: "Saved subject", submissionReference: null }))
      .toEqual({ reference: "", subject: "Saved subject", mailBody: "" });
  });

  it("isolates schedules and discards cancelled edits without mutating saved data", () => {
    const previous = { ...schedule, submissionSubject: "Saved A", submissionMailBody: "Memo A" };
    const editing = submissionMemoContent(previous);
    editing.subject = "Unsaved";
    editing.mailBody = "Cancelled";
    expect(submissionMemoContent({ id: "schedule-b", title: "Schedule B" }))
      .toEqual({ reference: "", subject: "Schedule B", mailBody: "" });
    expect(submissionMemoContent(previous))
      .toEqual({ reference: "", subject: "Saved A", mailBody: "Memo A" });
  });
});

describe("Audit Schedule submission memo defaults", () => {
  it("prefills new submissions from organization text values", () => {
    expect(submissionMemoDefaults({ from: "Quality Department", to: "All BU's, Function Heads and PM's" }, {}))
      .toEqual({ from: "Quality Department", to: "All BU's, Function Heads and PM's" });
  });
  it("uses current configured values on resubmission instead of obsolete defaults", () => {
    expect(submissionMemoDefaults({ from: "Updated department", to: "Updated audience" }, {
      submissionFrom: "Previous department", submissionTo: "Previous audience",
    })).toEqual({ from: "Updated department", to: "Updated audience" });
  });
  it("retains saved headings independently when a default is empty", () => {
    expect(submissionMemoDefaults({ from: "", to: "New audience" }, {
      submissionFrom: "Custom sender heading", submissionTo: "Previous audience",
    })).toEqual({ from: "Custom sender heading", to: "New audience" });
  });
  it("keeps unset defaults and unsaved headings blank", () => {
    expect(submissionMemoDefaults({ from: "", to: "" }, {})).toEqual({ from: "", to: "" });
  });
  it("trims values without changing the source objects", () => {
    const defaults = { from: "  Quality  ", to: "  Department heads  " };
    const previous = { submissionFrom: "Previous" };
    expect(submissionMemoDefaults(defaults, previous)).toEqual({ from: "Quality", to: "Department heads" });
    expect(defaults.from).toBe("  Quality  ");
    expect(previous.submissionFrom).toBe("Previous");
  });
});
