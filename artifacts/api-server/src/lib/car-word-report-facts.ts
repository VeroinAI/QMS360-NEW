import { validFindingDate } from "./car-dates";

type Row = Record<string, any>;

/** Calendar evidence only; updatedAt and CAR creation are never historical substitutes. */
export function carCalendarDate(value: unknown): string | null {
  const date = value instanceof Date ? Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : ""
    : typeof value === "string" ? value.slice(0, 10) : "";
  return validFindingDate(date) ? date : null;
}

export function carSubmissionDate(meta: Row, events: Row[]): string | null {
  const candidates = [meta.carApproval?.submittedAt,
    ...events.filter(event => ["submit", "resubmit"].includes(event.action)).map(event => event.createdAt)]
    .filter(value => carCalendarDate(value));
  // Dates from ordinary saves, acceptance and extension decisions are deliberately excluded.
  return candidates.length ? carCalendarDate(candidates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]) : null;
}

export function carVerification(car: Row | undefined, meta: Row, due: unknown) {
  const completed = car?.workflowState === "closed";
  const accepted = !!car && ["accepted", "closed"].includes(car.workflowState)
    && (meta.carApproval ? meta.carApproval.status === "Approved" : meta.reviewOutcome === "accept" || car.workflowState === "accepted");
  const closedAt = carCalendarDate(meta.closedAt), deadline = carCalendarDate(due);
  return { accepted, completed, withinAcd: !completed ? false : closedAt && deadline ? closedAt <= deadline : null };
}
