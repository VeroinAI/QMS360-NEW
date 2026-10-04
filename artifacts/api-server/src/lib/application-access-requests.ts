import type { Request } from "express";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  applicationAccess, db, users, userWorkspaceRoles, workspaceRoles,
  lessonsUserWorkspaceRoles, lessonsWorkspaceRoles, auditUserWorkspaceRoles, auditWorkspaceRoles,
  auditLogEntries, lessonsAuditLogEntries, auditAuditLogEntries,
} from "@workspace/db";
import { canManageAssignmentScope } from "../middlewares/rbac";
import { HttpError, writeAuditLog } from "./workspace";

export type Application = "qaqc" | "lessons" | "audit";
export type Access = typeof applicationAccess.$inferSelect;
export type Member = {
  id: string; username: string; fullName: string; email: string; roleId: string;
  projectIds: string[]; businessUnitIds: string[]; updatedAt: Date;
};
const flags = { qaqc: "canOpenQaqc", lessons: "canOpenLessons", audit: "canOpenAudit" } as const;
const assignments = { qaqc: userWorkspaceRoles, lessons: lessonsUserWorkspaceRoles, audit: auditUserWorkspaceRoles };
const roles = { qaqc: workspaceRoles, lessons: lessonsWorkspaceRoles, audit: auditWorkspaceRoles };
const logs = { qaqc: auditLogEntries, lessons: lessonsAuditLogEntries, audit: auditAuditLogEntries };

export function pendingApplicationRequests(
  app: Application, access: Access[], members: Member[],
  visible: (projects: string[], units?: string[]) => boolean,
) {
  const result: Array<{
    id: string; persistedId?: string; userId: string; username: string; fullName: string; email: string;
    requestedRoleId: string; status: "pending"; requestedAt: Date; projectId: string | null;
  }> = [];
  const grouped = new Map<string, Member[]>();
  for (const member of members) {
    const rows = grouped.get(member.username) ?? [];
    rows.push(member); grouped.set(member.username, rows);
  }
  for (const [username, allAssignments] of grouped) {
    const managed = allAssignments.filter(row => visible(row.projectIds, row.businessUnitIds));
    if (!managed.length) continue;
    const records = access.filter(row => row.username === username);
    if (records.some(row => row[flags[app]])) continue;
    const scoped = records.filter(row => !row.projectId || visible([row.projectId]));
    const rejected = records.filter(row => row.applicationReviews?.[app]?.status === "rejected")
      .sort((a, b) => Date.parse(b.applicationReviews[app]!.reviewedAt) - Date.parse(a.applicationReviews[app]!.reviewedAt))[0];
    // Only assignments the administrator can manage may renew a rejected request.
    const latestAssignment = Math.max(...managed.map(row => row.updatedAt.getTime()));
    if (rejected && latestAssignment <= Date.parse(rejected.applicationReviews[app]!.reviewedAt)) continue;
    const pending = scoped.find(row => row.applicationReviews?.[app]?.status === "pending"
      || (!row.applicationReviews?.[app] && row.status === "pending"));
    const existing = pending ?? scoped[0];
    // Do not bypass a persisted project boundary with a synthetic request.
    if (records.length && !existing) continue;
    const member = managed[0]!;
    result.push({
      id: pending?.id ?? (app !== "qaqc" ? existing?.id : undefined) ?? `missing:${member.id}`,
      persistedId: existing?.id, userId: member.id, username, fullName: member.fullName, email: member.email,
      requestedRoleId: member.roleId, status: "pending",
      requestedAt: pending ? new Date(pending.applicationReviews?.[app]?.reviewedAt ?? pending.createdAt) : new Date(latestAssignment),
      // New shared rows must not inherit one application's assignment scope:
      // other applications may have completely different project assignments.
      // Existing explicit legacy boundaries still constrain every decision.
      projectId: existing?.projectId ?? null,
    });
  }
  // Preserve imported explicit pending requests awaiting role assignment.
  for (const record of access) {
    if (app === "audit" || record[flags[app]] || grouped.has(record.username)
      || !visible(record.projectId ? [record.projectId] : [])) continue;
    const review = record.applicationReviews?.[app];
    if (review?.status !== "pending" && (review || record.status !== "pending")) continue;
    result.push({ id: record.id, persistedId: record.id, userId: "", username: record.username,
      fullName: record.username, email: "", requestedRoleId: "", status: "pending",
      requestedAt: new Date(review?.reviewedAt ?? record.createdAt), projectId: record.projectId });
  }
  return result.sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime());
}

export async function loadPendingApplicationRequests(
  req: Request, app: Application, executor: Pick<typeof db, "select"> = db,
  visible = (projects: string[], units?: string[]) => canManageAssignmentScope(req, projects, units),
) {
  const orgId = req.currentUser!.organizationId;
  const assignment = assignments[app], role = roles[app], log = logs[app];
  const [access, members, events] = await Promise.all([
    executor.select().from(applicationAccess).where(and(eq(applicationAccess.organizationId, orgId), isNull(applicationAccess.deletedAt))),
    executor.select({
      id: users.id, username: users.username, fullName: users.fullName, email: users.email,
      roleId: role.id, projectIds: assignment.projectIds, businessUnitIds: assignment.businessUnitIds, updatedAt: assignment.updatedAt,
    }).from(assignment)
      .innerJoin(users, and(eq(users.id, assignment.userId), eq(users.organizationId, orgId),
        isNull(users.deletedAt), eq(users.accessStatus, "active"), eq(users.status, "active")))
      .innerJoin(role, and(eq(role.id, assignment.workspaceRoleId), eq(role.organizationId, orgId),
        eq(role.status, "active"), isNull(role.deletedAt)))
      .where(and(eq(assignment.organizationId, orgId), eq(assignment.status, "active"), isNull(assignment.deletedAt))),
    executor.select({ entityId: log.entityId, action: log.action, createdAt: log.createdAt }).from(log)
      .where(and(eq(log.organizationId, orgId), inArray(log.entityType, ["application_access", "access_request"]),
        inArray(log.action, ["access_reject", "access_approve", "reject_access", "approve_access", "request_access"])))
      .orderBy(asc(log.createdAt), asc(log.id)),
  ]);
  const latest = new Map<string | null, typeof events[number]>();
  for (const event of events) {
    // A request event is not a review decision. In particular, Audit legacy
    // request_access events lack project scope: keep the last actual rejection
    // so only a newer manageable role assignment can renew it below.
    if (event.action !== "request_access" || !latest.has(event.entityId)) latest.set(event.entityId, event);
  }
  // Read-time transition: production receives the additive column via Publish.
  // Existing approvals remain authoritative; known legacy rejections use the
  // originating application's log timestamp, not shared updatedAt.
  const transitioned = access.map(row => {
    const event = latest.get(row.id);
    if (row.applicationReviews[app] || !event) return row;
    const status = event.action === "request_access" ? "pending"
      : event.action.includes("reject") ? "rejected" : "approved";
    return { ...row, applicationReviews: { ...row.applicationReviews, [app]: { status, reviewedAt: event.createdAt.toISOString() } } };
  });
  return pendingApplicationRequests(app, transitioned, members, visible);
}

export async function decideApplicationAccess(req: Request, app: Application, decision: "approve" | "reject", comments?: string | null) {
  const orgId = req.currentUser!.organizationId;
  return db.transaction(async tx => {
    // Shared lock across all applications, including synthetic requests: avoids
    // duplicate null-project rows and lost JSON updates across app decisions.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orgId}), hashtext('application-access-decisions'))`);
    const request = (await loadPendingApplicationRequests(req, app, tx)).find(row => row.id === String(req.params.id));
    if (!request) {
      const outsideScope = (await loadPendingApplicationRequests(req, app, tx, () => true))
        .some(row => row.id === String(req.params.id));
      if (outsideScope) throw new HttpError(403, "You may only manage access requests within your assigned projects");
      throw new HttpError(409, "Access request is no longer pending");
    }
    const [before] = request.persistedId
      ? await tx.select().from(applicationAccess).where(eq(applicationAccess.id, request.persistedId)).for("update") : [];
    const now = new Date();
    const reviews = { ...(before?.applicationReviews ?? {}), [app]: {
      status: decision === "approve" ? "approved" as const : "rejected" as const, reviewedAt: now.toISOString(),
    } };
    const values = { [flags[app]]: decision === "approve", applicationReviews: reviews, updatedAt: now };
    const [row] = before
      ? await tx.update(applicationAccess).set(values).where(eq(applicationAccess.id, before.id)).returning()
      : await tx.insert(applicationAccess).values({ organizationId: orgId, username: request.username, projectId: request.projectId, ...values }).returning();
    if (!row) throw new HttpError(500, "Failed to record access decision");
    await writeAuditLog(tx, app, { organizationId: orgId, actorId: req.currentUser!.id,
      action: app === "audit" ? `${decision}_access` : `access_${decision}`,
      entityType: "application_access", entityId: row.id, before, after: { ...row, comments }, ipAddress: req.ip });
    return row;
  });
}