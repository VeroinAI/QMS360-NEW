import { and, eq, isNull, sql } from "drizzle-orm";
import { db, users, userWorkspaceRoles, workspaceRoles, workspaceRolePermissions, permissions } from "@workspace/db";
import { qaqcPermissionMatches } from "@workspace/field-controls";
import { HttpError } from "./workspace";

// Server-owned snapshot, kept with the report's existing JSON baseline so
// deployment does not depend on adding a column to older production databases.
export const MONTHLY_APPROVAL_KEY = "__monthlyApproval";
export const DAILY_APPROVAL_KEY = "__dailyApproval";
export type SequentialReportType = "monthly" | "daily";
export const isSequentialReportType = (type: string): type is SequentialReportType => type === "monthly" || type === "daily";
export const reportApprovalKey = (type: SequentialReportType) => type === "daily" ? DAILY_APPROVAL_KEY : MONTHLY_APPROVAL_KEY;
export type ApprovalCandidate = { id: string; name: string };
export type ApprovalStage = { level: number; candidates: ApprovalCandidate[] };
export type ApprovalEvent = {
  cycle: number; level: number; decision: "submitted" | "approve" | "send_back";
  userId: string; at: string; comments: string;
};
export type MonthlyApproval = {
  version: 1; cycle: number; currentIndex: number; stages: ApprovalStage[]; history: ApprovalEvent[];
};
export type ApprovalGrant = {
  userId: string; name: string; roleId: string; roleName: string; level: number | null;
  key: string; grant?: string; available?: boolean; projectIds: string[] | null; businessUnitIds: string[] | null;
};

/** Shared monthly/daily engine; legacy export names retain monthly callers.
 * Scope must come from the SAME assignment that grants this report's approval. */
export function monthlyApprovalStages(rows: ApprovalGrant[], projectId: string, submitterId: string, reportType: SequentialReportType = "monthly") {
  const stages = new Map<number, Map<string, ApprovalCandidate>>();
  const configurationErrors = new Set<string>();
  for (const row of rows) {
    if (!qaqcPermissionMatches(row.key, `${reportType}_reports`, "approve_reject")) continue;
    if (row.grant === "select") continue;
    const organizationWide = !row.projectIds?.length && !row.businessUnitIds?.length;
    if (!organizationWide && !row.projectIds?.includes(projectId)) continue;
    if (!Number.isInteger(row.level) || Number(row.level) <= 0) {
      configurationErrors.add(`Set an Approval Level on role "${row.roleName}" in QA/QC Roles & Permissions.`);
      continue;
    }
    const candidates = stages.get(row.level!) ?? new Map<string, ApprovalCandidate>();
    // Keep a required level even when its only assignment is the submitter.
    if (row.available !== false && row.userId !== submitterId) candidates.set(row.userId, { id: row.userId, name: row.name });
    stages.set(row.level!, candidates);
  }
  const result = [...stages.entries()].sort(([a], [b]) => a - b).map(([level, candidates]) => ({
    level, candidates: [...candidates.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
  }));
  if (!result.length && !configurationErrors.size) configurationErrors.add(`No ${reportType} approval levels are configured for this project. Assign an active ${reportType} approval role with an Approval Level and project or organization-wide scope.`);
  for (const stage of result) if (!stage.candidates.length)
    configurationErrors.add(`Approval Level ${stage.level} has no active, authorized reviewer other than the submitter. Assign another active reviewer for this project.`);
  return { stages: result, errors: [...configurationErrors] };
}

export async function loadMonthlyApprovalStages(organizationId: string, projectId: string, submitterId: string, reportType: SequentialReportType = "monthly") {
  const rows = await db.select({
    userId: users.id, name: users.fullName, roleId: workspaceRoles.id, roleName: workspaceRoles.name,
    level: workspaceRoles.roleAuthorizationLevel, key: permissions.key, grant: workspaceRolePermissions.grant,
    available: sql<boolean>`(${users.accessStatus} = 'active' AND ${users.status} = 'active' AND ${users.deletedAt} IS NULL)`,
    projectIds: userWorkspaceRoles.projectIds, businessUnitIds: userWorkspaceRoles.businessUnitIds,
  }).from(userWorkspaceRoles)
    .innerJoin(users, eq(users.id, userWorkspaceRoles.userId))
    .innerJoin(workspaceRoles, eq(workspaceRoles.id, userWorkspaceRoles.workspaceRoleId))
    .innerJoin(workspaceRolePermissions, eq(workspaceRolePermissions.workspaceRoleId, workspaceRoles.id))
    .innerJoin(permissions, eq(permissions.id, workspaceRolePermissions.permissionId))
    .where(and(
      eq(userWorkspaceRoles.organizationId, organizationId), eq(users.organizationId, organizationId),
      eq(workspaceRoles.organizationId, organizationId),
      eq(userWorkspaceRoles.status, "active"), isNull(userWorkspaceRoles.deletedAt),
      eq(workspaceRoles.status, "active"), isNull(workspaceRoles.deletedAt),
      eq(workspaceRolePermissions.status, "active"), isNull(workspaceRolePermissions.deletedAt),
      eq(permissions.status, "active"), isNull(permissions.deletedAt),
    ));
  let eligible = rows;
  if (process.env.AUTH_STRATEGY === "drona") {
    // Read source membership without provisioning users or broadening QMS scope.
    const memberships = await db.execute(sql`
      SELECT DISTINCT l.user_id AS id
      FROM shared.drona_user_links l
      JOIN shared.users u ON u.id = l.user_id AND u.organization_id = l.organization_id
      JOIN public.user_master s ON s.user_id = l.external_user_id
      JOIN public.user_role_mapping a ON a.user_id = s.user_id AND a.is_active = true
      JOIN public.project_mapping m ON m.project_map_id = a.project_map_id
      JOIN public.project_master p ON p.project_id = m.project_id AND p.is_active = true
      JOIN shared.drona_project_links pl ON pl.external_project_id = p.project_id
        AND pl.environment_key = l.environment_key AND pl.organization_id = l.organization_id
      WHERE l.organization_id = ${organizationId}::uuid AND l.environment_key = ${process.env.DRONA_ENVIRONMENT!}
        AND pl.project_id = ${projectId}::uuid AND s.is_active = true
        AND lower(btrim(s.user_email)) = lower(btrim(u.email))
    `);
    const ids = new Set((memberships.rows as { id: string }[]).map(row => row.id));
    eligible = rows.map(row => ({ ...row, available: row.available && ids.has(row.userId) }));
  }
  return monthlyApprovalStages(eligible, projectId, submitterId, reportType);
}

export function readMonthlyApproval(baseline: Record<string, any> | null | undefined, reportType: SequentialReportType = "monthly"): MonthlyApproval | undefined {
  const value = baseline?.[reportApprovalKey(reportType)];
  return value?.version === 1 && Array.isArray(value.stages) && Array.isArray(value.history) ? value : undefined;
}

/** Participation preserves own-record reading, never approval or project access. */
export function hasMonthlyReviewHistory(row: { reportType: string; baseline?: Record<string, any> | null }, userId: string) {
  return isSequentialReportType(row.reportType) && !!readMonthlyApproval(row.baseline, row.reportType)?.history.some(event =>
    event.userId === userId && (event.decision === "approve" || event.decision === "send_back"));
}

export function startMonthlyApproval(stages: ApprovalStage[], approverId: string, submitterId: string, at: string, previous?: MonthlyApproval): MonthlyApproval {
  if (!stages.length || stages.some(stage => !stage.candidates.length)) throw new HttpError(422, "Every approval level must have an eligible reviewer.");
  if (!stages[0]!.candidates.some(candidate => candidate.id === approverId))
    throw new HttpError(422, `Select an eligible approver at Approval Level ${stages[0]!.level}.`);
  const cycle = (previous?.cycle ?? 0) + 1;
  return { version: 1, cycle, currentIndex: 0, stages, history: [
    ...(previous?.history ?? []), { cycle, level: stages[0]!.level, decision: "submitted", userId: submitterId, at, comments: "" },
  ] };
}

export function advanceMonthlyApproval(workflow: MonthlyApproval, decision: "approve" | "send_back", userId: string, at: string, comments: string) {
  const current = workflow.stages[workflow.currentIndex];
  if (!current || !current.candidates.some(candidate => candidate.id === userId))
    throw new HttpError(403, "You are not a reviewer at the current approval level.");
  const next = decision === "approve" ? workflow.stages[workflow.currentIndex + 1] : undefined;
  return {
    ...workflow,
    currentIndex: decision === "approve" ? workflow.currentIndex + 1 : workflow.currentIndex,
    history: [...workflow.history, { cycle: workflow.cycle, level: current.level, decision, userId, at, comments }],
    next,
  };
}
