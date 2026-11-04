import { describe, expect, it } from "vitest";
import { openingMeetingDateError, meetingDateError } from "@workspace/field-controls";

describe("Opening meeting inclusive calendar boundaries", () => {
  it.each(["2026-10-04T00:00", "2026-10-06T23:59:59.999", "2026-10-04T00:01+14:00", "2026-10-06T23:59-12:00"])("accepts the full boundary day without timezone shifts: %s", value => {
    expect(openingMeetingDateError(value, "2026-10-04", "2026-10-06")).toBeNull();
  });
  it.each(["2026-10-03T23:59", "2026-10-07T00:00", "2026-10-03T23:59-12:00", "2026-10-07T00:00+14:00"])("rejects manual/API input outside the range: %s", value => {
    expect(openingMeetingDateError(value, "2026-10-04", "2026-10-06")).toContain("04/10/2026 to 06/10/2026 (inclusive)");
  });
  it("allows every time on a single-day audit and rejects invalid inputs", () => {
    for (const time of ["00:00", "23:59:59.999"]) expect(openingMeetingDateError(`2026-10-04T${time}`, "2026-10-04", "2026-10-04")).toBeNull();
    for (const value of ["2026-10-04", "2026-10-04T24:00", "2026-02-30T10:00", "bad"]) {
      expect(openingMeetingDateError(value, "2026-10-04", "2026-10-06")).toContain("valid date and time within");
    }
    for (const [from, to] of [[null, null], ["2026-02-30", "2026-10-06"], ["2026-10-07", "2026-10-04"]]) {
      expect(openingMeetingDateError("2026-10-04T10:00", from, to)).toContain("Correct the Audit schedule dates");
    }
  });
});

describe("Closing Meeting shares the inclusive wall-clock policy", () => {
  it.each(["2026-10-04T00:00", "2026-10-06T23:59:59.999", "2026-10-04T00:01+14:00", "2026-10-06T23:59-12:00"])("accepts boundary input %s", value => {
    expect(meetingDateError("closing", value, "2026-10-04", "2026-10-06")).toBeNull();
  });
  it.each(["2026-10-03T23:59-12:00", "2026-10-07T00:00+14:00", "", null, "bad", "2026-10-04", "2026-10-04T24:00", "2026-02-30T10:00", "2026-10-04T12:00+24:00"])("rejects malformed or outside input %s", value => {
    expect(meetingDateError("closing", value, "2026-10-04", "2026-10-06")).toContain("Closing Meeting Held at");
  });
  it("accepts the full single day without adding opening/closing sequencing", () => {
    for (const time of ["00:00", "23:59:59.999", "00:00+14:00", "23:59-12:00"]) {
      expect(meetingDateError("closing", `2026-10-04T${time}`, "2026-10-04", "2026-10-04")).toBeNull();
    }
  });
  it.each([[null, null], ["bad", "2026-10-06"], ["2026-02-30", "2026-10-06"], ["2026-10-07", "2026-10-04"]])("requires corrected authoritative dates %s %s", (from, to) => {
    expect(meetingDateError("closing", "2026-10-04T10:00", from, to)).toContain("Correct the Audit schedule dates before saving the Closing Meeting");
  });
});
