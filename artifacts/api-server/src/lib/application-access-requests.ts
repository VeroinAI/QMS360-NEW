import type { Request } from "express";
import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
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
type Executor = Pick<typeof db, "select">;
type Visibility = (projects: string[], units?: string[]) => boolean;
export type PendingRequest = {
  id: string; persistedId?: string; userId: string; username: string; fullName: string; email: string;
  requestedRoleId: string; status: "pending"; requestedAt: Date; projectId: string | null;
};
const batchSize = 250;

// Match canManageAssignmentScope exactly: intersection alone is insufficient,
// and business-unit-only/unscoped assignments are not project-manageable.
function assignmentScope(req: Request, app: Application) {
  if (req.permissionAdminBypass || req.permissionProjectScope?.unrestricted) return undefined;
  const assignment = assignments[app];
  const projects = req.permissionProjectScope?.projectIds ?? [];
  return sql`cardinality(${assignment.businessUnitIds}) = 0
    and cardinality(${assignment.projectIds}) > 0
    and ${assignment.projectIds} <@ ${sql`ARRAY[${sql.join(projects.map(id => sql`${id}`), sql`, `)}]::uuid[]`}`;
}

export function comparePendingRequests(a: PendingRequest, b: PendingRequest) {
  return b.requestedAt.getTime() - a.requestedAt.getTime()
    || a.username.localeCompare(b.username) || a.id.localeCompare(b.id);
}

export function pendingApplicationRequests(
  app: Application, access: Access[], members: Member[],
  visible: (projects: string[], units?: string[]) => boolean,
) {
  const result: PendingRequest[] = [];
  const grouped = new Map<string, Member[]>();
  const accessByUsername = new Map<string, Access[]>();
  for (const row of access) {
    const rows = accessByUsername.get(row.username) ?? [];
    rows.push(row); accessByUsername.set(row.username, rows);
  }
  for (const member of members) {
    const rows = grouped.get(member.username) ?? [];
    rows.push(member); grouped.set(member.username, rows);
  }
  for (const [username, allAssignments] of grouped) {
    const managed = allAssignments.filter(row => visible(row.projectIds, row.businessUnitIds));
    if (!managed.length) continue;
    const records = accessByUsername.get(username) ?? [];
    if (records.some(row => row[flags[app]])) continue;
    const scoped = records.filter(row => !row.projectId || visible([row.projectId]));
    const rejected = records.filter(row => row.applicationReviews?.[app]?.status === "rejected")
      .sort((a, b) => Date.parse(b.applicationReviews[app]!.reviewedAt) - Date.parse(a.applicationReviews[app]!.reviewedAt))[0];
    // Only assignments the administrator can manage may renew a rejected request.
    const latestAssignment = managed.reduce((latest, row) => Math.max(latest, row.updatedAt.getTime()), 0);
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
  return result.sort(comparePendingRequests);
}

function memberQuery(req: Request, app: Application, executor: Executor, filterScope: boolean, usernames?: string[], excludeApproved = false) {
  const orgId = req.currentUser!.organizationId;
  const assignment = assignments[app], role = roles[app];
  return executor.select({
      id: users.id, username: users.username, fullName: users.fullName, email: users.email,
      roleId: role.id, projectIds: assignment.projectIds, businessUnitIds: assignment.businessUnitIds, updatedAt: assignment.updatedAt,
    }).from(assignment)
      .innerJoin(users, and(eq(users.id, assignment.userId), eq(users.organizationId, orgId),
        isNull(users.deletedAt), eq(users.accessStatus, "active"), eq(users.status, "active")))
      .innerJoin(role, and(eq(role.id, assignment.workspaceRoleId), eq(role.organizationId, orgId),
        eq(role.status, "active"), isNull(role.deletedAt)))
      .where(and(eq(assignment.organizationId, orgId), eq(assignment.status, "active"), isNull(assignment.deletedAt),
        usernames ? inArray(users.username, usernames) : undefined,
        excludeApproved ? sql`not exists (select 1 from ${applicationAccess}
          where ${applicationAccess.organizationId} = ${orgId}
            and ${applicationAccess.username} = ${users.username}
            and ${applicationAccess.deletedAt} is null and ${applicationAccess[flags[app]]} = true)` : undefined,
        filterScope ? assignmentScope(req, app) : undefined));
}

async function loadUserRequests(
  req: Request, app: Application, usernames: string[], executor: Executor, visible: Visibility, filterScope: boolean,
) {
  if (!usernames.length) return [];
  const orgId = req.currentUser!.organizationId, log = logs[app];
  const [access, members] = await Promise.all([
    executor.select().from(applicationAccess).where(and(eq(applicationAccess.organizationId, orgId),
      isNull(applicationAccess.deletedAt), inArray(applicationAccess.username, usernames)))
      .orderBy(asc(applicationAccess.createdAt), asc(applicationAccess.id)),
    memberQuery(req, app, executor, filterScope, usernames)
      .orderBy(asc(assignments[app].id)),
  ]);
  const legacyIds = access.filter(row => !row.applicationReviews[app]).map(row => row.id);
  // Return at most one event per legacy row. Prefer the latest real decision;
  // when there is no decision preserve the first request event, as before.
  const events = legacyIds.length ? await executor.select({
    id: applicationAccess.id,
    event: sql<{ action: string; createdAt: string } | null>`(
      select json_build_object('action', ${log.action}, 'createdAt', ${log.createdAt})
      from ${log}
      where ${log.organizationId} = ${orgId}
        and ${log.entityId} = ${sql.identifier("application_access")}.${sql.identifier("id")}
        and ${log.entityType} in ('application_access', 'access_request')
        and ${log.action} in ('access_reject', 'access_approve', 'reject_access', 'approve_access', 'request_access')
      order by (${log.action} <> 'request_access') desc,
        case when ${log.action} <> 'request_access' then ${log.createdAt} end desc,
        case when ${log.action} = 'request_access' then ${log.createdAt} end asc,
        case when ${log.action} <> 'request_access' then ${log.id} end desc,
        ${log.id} asc limit 1
    )`,
  }).from(applicationAccess).where(and(eq(applicationAccess.organizationId, orgId),
    isNull(applicationAccess.deletedAt), inArray(applicationAccess.id, legacyIds))) : [];
  const latest = new Map(events.map(row => [row.id, row.event]));
  // Read-time transition: production receives the additive column via Publish.
  // Existing approvals remain authoritative; known legacy rejections use the
  // originating application's log timestamp, not shared updatedAt.
  const transitioned = access.map(row => {
    const event = latest.get(row.id);
    if (row.applicationReviews[app] || !event) return row;
    const status = event.action === "request_access" ? "pending"
      : event.action.includes("reject") ? "rejected" : "approved";
    return { ...row, applicationReviews: { ...row.applicationReviews, [app]: { status, reviewedAt: new Date(event.createdAt).toISOString() } } };
  });
  return pendingApplicationRequests(app, transitioned, members, visible);
}

// Keyset-batch candidate usernames before resolving legacy outcomes. All rows
// for each candidate are retained (even outside scope): any approval or previous
// rejection is authoritative. Orphan imports require NO active app assignment,
// not merely no assignment inside the reviewing administrator's projects.
async function* requestBatches(req: Request, app: Application, executor: Executor, visible: Visibility) {
  const orgId = req.currentUser!.organizationId;
  const memberCandidates = memberQuery(req, app, executor, true, undefined, true).as("member_candidates");
  const allMembers = memberQuery(req, app, executor, false).as("all_members");
  const accessCandidates = executor.select({ username: applicationAccess.username }).from(applicationAccess)
    .where(and(eq(applicationAccess.organizationId, orgId), isNull(applicationAccess.deletedAt),
      eq(applicationAccess[flags[app]], false),
      sql`(${applicationAccess.applicationReviews} -> ${app} is null
        or ${applicationAccess.applicationReviews} -> ${app} ->> 'status' = 'pending')`,
      canManageAssignmentScope(req, []) ? undefined
        : inArray(applicationAccess.projectId, req.permissionProjectScope?.projectIds ?? []),
      app === "audit" ? sql`false` : sql`not exists (select 1 from ${allMembers}
        where ${allMembers.username} = ${applicationAccess.username})`));
  const candidates = executor.select({ username: memberCandidates.username }).from(memberCandidates)
    .union(accessCandidates).as("candidates");
  let after: string | undefined;
  while (true) {
    const rows = await executor.select({ username: candidates.username }).from(candidates)
      .where(after === undefined ? undefined : gt(candidates.username, after))
      .orderBy(asc(candidates.username)).limit(batchSize);
    if (!rows.length) break;
    yield await loadUserRequests(req, app, rows.map(row => row.username), executor, visible, true);
    after = rows[rows.length - 1]!.username;
    if (rows.length < batchSize) break;
  }
}

export async function loadPendingApplicationRequests(req: Request, app: Application, executor: Executor = db) {
  const result: PendingRequest[] = [];
  for await (const rows of requestBatches(req, app, executor, (projects, units) => canManageAssignmentScope(req, projects, units))) {
    result.push(...rows);
  }
  return result.sort(comparePendingRequests);
}

export async function loadPendingApplicationRequestPage(
  req: Request, app: Application, offset: number, limit: number, executor: Executor = db,
) {
  let total = 0, retained: PendingRequest[] = [];
  // Exact totals and legacy renewal require resolving candidates before paging.
  // Retain only the requested prefix rather than the organization's entire queue.
  for await (const rows of requestBatches(req, app, executor, (projects, units) => canManageAssignmentScope(req, projects, units))) {
    total += rows.length;
    retained = retained.concat(rows).sort(comparePendingRequests).slice(0, offset + limit);
  }
  return { items: retained.slice(offset, offset + limit), total };
}

export async function decideApplicationAccess(req: Request, app: Application, decision: "approve" | "reject", comments?: string | null) {
  const orgId = req.currentUser!.organizationId;
  const id = String(req.params.id);
  const targetId = id.startsWith("missing:") ? id.slice(8) : id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetId)) {
    throw new HttpError(409, "Access request is no longer pending");
  }
  const [target] = id.startsWith("missing:")
    ? await db.select({ username: users.username }).from(users)
      .where(and(eq(users.organizationId, orgId), eq(users.id, id.slice(8)), isNull(users.deletedAt)))
    : await db.select({ username: applicationAccess.username }).from(applicationAccess)
      .where(and(eq(applicationAccess.organizationId, orgId), eq(applicationAccess.id, id), isNull(applicationAccess.deletedAt)));
  if (!target) throw new HttpError(409, "Access request is no longer pending");
  return db.transaction(async tx => {
    // Shared lock across all applications, including synthetic requests: avoids
    // duplicate null-project rows and lost JSON updates across app decisions.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orgId}), hashtext(${`application-access:${target.username}`}))`);
    const visible = (projects: string[], units?: string[]) => canManageAssignmentScope(req, projects, units);
    const matches = (row: PendingRequest) => row.id === id || id === `missing:${row.userId}`;
    const request = (await loadUserRequests(req, app, [target.username], tx, visible, false)).find(matches);
    if (!request) {
      const outsideScope = (await loadUserRequests(req, app, [target.username], tx, () => true, false))
        .some(matches);
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