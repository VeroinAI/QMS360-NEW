import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlanDateTimeField } from "./plan-date-time-field";

describe("Audit Plan per-field remarks", () => {
  it.each([
    [11, "Start Date & Time"], [12, "End Date & Time"],
    [13, "Opening Meeting"], [14, "Closing Meeting"],
  ] as const)("keeps field %s numbered and offers its own remark button", (number, label) => {
    const html = renderToStaticMarkup(<PlanDateTimeField number={number} label={label}
      onRemarkChange={() => {}} inputProps={{ value: "2026-10-12T09:00", onChange: () => {} }}/>);
    expect(html).toContain(`${number}.`);
    // The shared Input renders tenant-formatted date/time text plus a picker.
    expect(html).toContain("12/10/2026 09:00");
    expect(html).toContain(`Maintain remark for ${label.replace("&", "&amp;")}`);
    expect(html).toContain("Remark");
  });

  it("indicates an existing remark without exposing it in the date input", () => {
    const html = renderToStaticMarkup(<PlanDateTimeField number={13} label="Opening Meeting"
      remark="Opening agenda" onRemarkChange={() => {}} inputProps={{ value: "2026-10-12T09:00", onChange: () => {} }}/>);
    expect(html).toContain("A remark has been entered");
    expect(html).not.toContain('value="Opening agenda"');
  });

  it("allows viewing remarks while dates are read-only", () => {
    const html = renderToStaticMarkup(<PlanDateTimeField number={14} label="Closing Meeting"
      remarkReadOnly remark="Closing agenda" onRemarkChange={() => {}} inputProps={{ disabled: true }}/>);
    expect(html).toContain("View remark for Closing Meeting");
    expect(html).toMatch(/<input[^>]+\sdisabled=""/);
    const remarkButton = html.match(/<button[^>]+aria-label="View remark for Closing Meeting"[^>]*>/)?.[0];
    expect(remarkButton).toBeDefined();
    expect(remarkButton).not.toMatch(/\sdisabled(?:=|\s|>)/);
  });
});
