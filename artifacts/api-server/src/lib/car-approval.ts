import { db } from "@workspace/db";
import { HttpError } from "./workspace";
import { reportReviewers, type ReportReviewer, type AuditReportApprovalState } from "./audit-report-approval";

export type CarApprovalState = AuditReportApprovalState & {
  cycle: number;
  reviewers: Array<{ userId: string; roleId: string }>;
};
export const carReviewers = (database: Pick<typeof db, "select">, org: string, project?: string | null, department?: string | null) =>
  reportReviewers(database, org, project, department, "audit.cars.approve_reject");

export function submitCarApproval(reviewers: ReportReviewer[], userId: string, previous?: CarApprovalState): CarApprovalState {
  if (!reviewers.length) throw new HttpError(409, "No CAR approvers are configured for this project or department. Assign active users to roles with Corrective Action Reports approval and a positive Approval Level in Settings → Roles & Permissions.");
  const steps = new Map<number, CarApprovalState["steps"][number]>();
  for (const reviewer of reviewers) {
    if (!Number.isInteger(reviewer.level) || reviewer.level! < 1 || reviewer.level! > 2147483647) throw new HttpError(409, `Set a positive whole-number Approval Level on CAR role "${reviewer.roleName}" in Settings → Roles & Permissions.`);
    const level = reviewer.level!;
    const step = steps.get(level) ?? { level, roleIds: [], approvers: [] };
    if (!step.roleIds.includes(reviewer.roleId)) step.roleIds.push(reviewer.roleId);
    if (!step.approvers.some(user => user.id === reviewer.userId)) step.approvers.push({ id: reviewer.userId, name: reviewer.userName });
    steps.set(level, step);
  }
  return { status: "Pending approval", steps: [...steps.values()].sort((a,b) => a.level-b.level), index: 0,
    submittedById: userId, submittedAt: new Date().toISOString(), history: previous?.history ?? [],
    cycle: (previous?.cycle ?? 0) + 1, reviewers: reviewers.map(({ userId, roleId }) => ({ userId, roleId })) };
}
export function eligibleCarReviewers(state: CarApprovalState | undefined, live: ReportReviewer[]) {
  const step = state?.status === "Pending approval" ? state.steps[state.index] : undefined;
  return step ? live.filter(user => step.roleIds.includes(user.roleId) && step.approvers.some(p => p.id === user.userId)
    && state!.reviewers.some(p => p.userId === user.userId && p.roleId === user.roleId)) : [];
}
export const canReviewCar = (state: CarApprovalState | undefined, live: ReportReviewer[], userId: string) =>
  eligibleCarReviewers(state, live).some(user => user.userId === userId);

export function reviewCarApproval(state: CarApprovalState, live: ReportReviewer[], userId: string, userName: string, decision: string, remarks = ""): CarApprovalState {
  if (state.status !== "Pending approval") throw new HttpError(409, "This CAR is no longer pending approval. Refresh the page.");
  if (!canReviewCar(state, live, userId)) throw new HttpError(403, "Only a currently eligible reviewer at the pending CAR Approval Level may act.");
  if (decision !== "accept" && !remarks.trim()) throw new HttpError(422, "Enter remarks for query or rework.");
  const next = state.steps[state.index + 1];
  if (decision === "accept" && next && !eligibleCarReviewers({ ...state, index: state.index + 1 }, live).length)
    throw new HttpError(409, `CAR Approval Level ${next.level} has no eligible reviewers. Ask an administrator to restore the saved reviewer assignments.`);
  return { ...state, status: decision !== "accept" ? "Sent back" : next ? "Pending approval" : "Approved",
    index: decision === "accept" && next ? state.index + 1 : state.index,
    history: [...state.history, { decision, userId, userName, level: state.steps[state.index]!.level, remarks: remarks.trim(), at: new Date().toISOString() }] };
}
export function carApprovalSummary(state?: CarApprovalState) {
  return { status: state?.status ?? "Not submitted", pendingLevel: state?.status === "Pending approval" ? state.steps[state.index]?.level ?? null : null,
    finalLevel: state?.steps.at(-1)?.level ?? null, history: (state?.history ?? []).map(({ userId, ...entry }) => entry) };
}
