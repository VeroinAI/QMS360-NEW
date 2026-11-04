const UUID = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
const identity = (value: string) => UUID.test(value.trim()) ? value.trim().toLowerCase() : value.trim();
export const NOT_REPRESENTED_CLOSING = "Not represented in Closing meeting";

/** Compare identities, not names; retain distinct people with identical names. */
export function notRepresentedClosingAttendees(opening: readonly string[] = [], closing: readonly string[] = []): string[] {
  const represented = new Set(closing.map(identity));
  const seen = new Set<string>();
  return opening.filter(value => {
    const key = identity(value);
    if (!key || represented.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export function meetingAttendeeLabel(id: string, users: ReadonlyArray<{ id: string; fullName: string }>): string {
  return users.find(user => identity(user.id) === identity(id))?.fullName?.trim()
    || (UUID.test(id.trim()) ? "Former Audit user" : id.trim());
}

