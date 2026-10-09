import { describe, expect, it } from "vitest";
import { meetingAttendeeLabel, notRepresentedClosingAttendees } from "./meeting-attendees";

const alice = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const bob = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const carol = "cccccccc-cccc-4ccc-cccc-cccccccccccc";
describe("Not Represented in closing meeting", () => {
  it("shows opening attendees absent from closing, in their opening order", () => {
    expect(notRepresentedClosingAttendees([alice, bob, carol], [bob])).toEqual([alice, carol]);
  });
  it("updates when an attendee is added to or removed from closing", () => {
    expect(notRepresentedClosingAttendees([alice, bob], [])).toEqual([alice, bob]);
    expect(notRepresentedClosingAttendees([alice, bob], [alice])).toEqual([bob]);
    expect(notRepresentedClosingAttendees([alice, bob], [alice, bob])).toEqual([]);
    expect(notRepresentedClosingAttendees([alice, bob], [bob])).toEqual([alice]);
  });
  it("does not include closing-only attendees", () => {
    expect(notRepresentedClosingAttendees([alice], [bob])).toEqual([alice]);
  });
  it("handles empty opening and closing meetings", () => {
    expect(notRepresentedClosingAttendees()).toEqual([]);
    expect(notRepresentedClosingAttendees(undefined, [alice])).toEqual([]);
    expect(notRepresentedClosingAttendees([alice])).toEqual([alice]);
  });
  it("removes duplicate/blank legacy entries without changing original attendee arrays", () => {
    const opening = [alice, alice, "", " ", bob];
    const closing = [bob];
    expect(notRepresentedClosingAttendees(opening, closing)).toEqual([alice]);
    expect(opening).toEqual([alice, alice, "", " ", bob]);
    expect(closing).toEqual([bob]);
  });
  it("matches UUIDs case-insensitively and preserves old typed names", () => {
    expect(notRepresentedClosingAttendees([alice.toUpperCase(), "Legacy attendee"], [alice])).toEqual(["Legacy attendee"]);
    expect(notRepresentedClosingAttendees([" Legacy attendee "], ["Legacy attendee"])).toEqual([]);
  });
  it("compares user IDs even when two users have the same display name", () => {
    const users = [{ id: alice, fullName: "Same Name" }, { id: bob, fullName: "Same Name" }];
    expect(notRepresentedClosingAttendees(users.map(user => user.id), [alice])).toEqual([bob]);
    expect(meetingAttendeeLabel(bob, users)).toBe("Same Name");
  });
  it("resolves names without displaying raw user IDs and retains legacy text", () => {
    expect(meetingAttendeeLabel(alice.toUpperCase(), [{ id: alice, fullName: "Alice" }])).toBe("Alice");
    expect(meetingAttendeeLabel(bob, [])).toBe("Former Audit user");
    expect(meetingAttendeeLabel("Legacy attendee", [])).toBe("Legacy attendee");
  });
});
