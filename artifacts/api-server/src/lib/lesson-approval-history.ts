type Person = { fullName: string; designation?: string | null };
type Event = { id: string; action: string; actorId: string | null; createdAt: Date | string; after: unknown };
type Current = {
  submittedAt?: Date | string | null; submittedById?: string | null; submittedByName?: string | null;
  submittedByDesignation?: string | null; submittedBySignatureUrl?: string | null;
  reviewedAt?: Date | string | null; reviewedById?: string | null; reviewedByName?: string | null;
  reviewedByDesignation?: string | null; reviewedBySignatureUrl?: string | null;
  reviewDecision?: string | null; reviewComments?: string | null;
};
export const lessonApprovalActions = ["submit", "approve", "send_back", "reject", "transfer"] as const;
const text = (value: unknown) => typeof value === "string" && value.trim() ? value : null;
const iso = (value: unknown) => {
  if (!(value instanceof Date) && typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
const json = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Preserve each approval cycle; current fields only fill genuine legacy gaps. */
export function lessonApprovalHistory(events: Event[], people: Map<string, Person>, current: Current) {
  const entries = events.filter(event => (lessonApprovalActions as readonly string[]).includes(event.action)).map(event => {
    const after = json(event.after), person = people.get(event.actorId ?? "");
    const submitted = event.action === "submit";
    const reviewed = ["approve", "send_back", "reject"].includes(event.action);
    const prefix = submitted ? "submittedBy" : reviewed ? "reviewedBy" : "";
    return {
      id: event.id, action: event.action === "reject" ? "send_back" : event.action,
      actorId: event.actorId,
      actorName: text(after[`${prefix}Name`]) ?? person?.fullName ?? (event.actorId ? "Unavailable user" : "System"),
      actorDesignation: text(after[`${prefix}Designation`]) ?? person?.designation ?? null,
      occurredAt: iso(event.createdAt)!,
      comments: reviewed ? text(after.reviewComments) ?? text(after.remarks) : event.action === "transfer" ? text(after.transferText) ?? text(after.reason) : null,
      signatureUrl: null as string | null,
      eventTimestamp: iso(submitted ? after.submittedAt : reviewed ? after.reviewedAt : null),
    };
  });
  const legacy = [
    { action: "submit", at: current.submittedAt, actorId: current.submittedById, name: current.submittedByName,
      designation: current.submittedByDesignation, signature: current.submittedBySignatureUrl, comments: null },
    { action: current.reviewDecision === "approve" ? "approve" : ["send_back", "reject"].includes(current.reviewDecision ?? "") ? "send_back" : "review", at: current.reviewedAt,
      actorId: current.reviewedById, name: current.reviewedByName, designation: current.reviewedByDesignation,
      signature: current.reviewedBySignatureUrl, comments: current.reviewComments },
  ];
  for (const item of legacy) {
    const occurredAt = iso(item.at);
    if (!occurredAt) continue;
    const existing = entries.find(entry => entry.action === item.action && entry.actorId === (item.actorId ?? null)
      && (entry.eventTimestamp === occurredAt || Math.abs(Date.parse(entry.occurredAt) - Date.parse(occurredAt)) < 1000));
    if (existing) {
      // Keep the existing current-record signature display without assigning
      // today's profile signature to unrelated historical approval cycles.
      existing.signatureUrl = item.signature ?? null;
      continue;
    }
    entries.push({
      id: `legacy-${item.action}-${occurredAt}`, action: item.action, actorId: item.actorId ?? null,
      actorName: item.name ?? people.get(item.actorId ?? "")?.fullName ?? "Unavailable user",
      actorDesignation: item.designation ?? null, occurredAt, comments: item.comments ?? null,
      signatureUrl: item.signature ?? null, eventTimestamp: occurredAt,
    });
  }
  return entries.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || b.id.localeCompare(a.id))
    .map(({ eventTimestamp: _internal, ...entry }) => entry);
}
