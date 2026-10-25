import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NotRepresentedClosingAttendees } from "./not-represented-closing-attendees";
import { MeetingHeldAt } from "./meeting-held-at";
// Assert the bounds supplied to the shared organization-format date picker.
vi.mock("@/components/ui/input", () => ({ Input: (props: React.ComponentProps<"input">) => <input {...props}/> }));

describe("Closing meeting attendance display", () => {
  const alice = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
  const bob = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
  const users = [{ id: alice, fullName: "Same Name" }, { id: bob, fullName: "Same Name" }];
  it("shows the exact heading and distinct missing identities once", () => {
    const html = renderToStaticMarkup(<NotRepresentedClosingAttendees opening={[alice, bob, bob, "Legacy attendee"]} closing={[alice]} users={users}/>);
    expect(html).toContain("Not represented in Closing meeting");
    expect(html).toContain("2 automatically selected");
    expect(html).toContain("Same Name");
    expect(html).toContain("Legacy attendee");
    expect(html).not.toContain(bob);
  });
  it("distinguishes recorded empty attendance from absent evidence", () => {
    expect(renderToStaticMarkup(<NotRepresentedClosingAttendees opening={[]} closing={[]} users={[]}/>)).toContain("None");
    const missing = renderToStaticMarkup(<NotRepresentedClosingAttendees closing={[]} users={[]}/>);
    expect(missing).toContain("Opening attendance not recorded");
    expect(missing).not.toContain(">None<");
    expect(renderToStaticMarkup(<NotRepresentedClosingAttendees opening={[alice]} users={users}/>)).toContain("Closing attendance not recorded");
  });
});

describe.each(["opening", "closing"] as const)("%s meeting Held at input", kind => {
  const render = (props: Partial<Parameters<typeof MeetingHeldAt>[0]> = {}) => renderToStaticMarkup(
    <MeetingHeldAt kind={kind} value="2026-10-04T00:00" locked={false} from="2026-10-04" to="2026-10-06" onChange={() => {}} {...props}/>);
  it("disables days beyond the actual individual audit, retaining both complete boundary days", () => {
    const html = render();
    expect(html).toContain('min="2026-10-04T00:00"');
    expect(html).toContain('max="2026-10-06T23:59:59.999"');
    expect(html).not.toContain('disabled=""');
    expect(html).toContain('aria-invalid="false"');
  });
  it("keeps invalid historical values readable with an allowed-period correction", () => {
    const html = render({ value: "2026-10-01T10:00" });
    expect(html).toContain('value="2026-10-01T10:00"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("04/10/2026 to 06/10/2026 (inclusive)");
  });
  it("fails closed without authoritative dates", () => {
    const html = render({ from: null });
    expect(html).toContain('disabled=""');
    expect(html).not.toContain(' min="');
    expect(html).toContain("Correct the Audit schedule dates");
  });
  it("shows the allowed period with a kind-specific accessible description", () => {
    const html = render();
    expect(html).toContain(`aria-describedby="${kind}-held-at-help"`);
    expect(html).toContain("Allowed period: 04/10/2026 to 06/10/2026 (inclusive)");
  });
  it.each([{ from: "2026-10-07" }, { from: "invalid" }, { to: null }])("disables unusable bounds %s", props => {
    expect(render(props)).toContain('disabled=""');
  });
});
