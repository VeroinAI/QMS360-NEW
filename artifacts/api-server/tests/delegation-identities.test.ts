import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import type { Server } from "node:http";
import { eq, inArray } from "drizzle-orm";
import {
  auditDelegations,
  db,
  delegations,
  organizations,
  platformRoles,
  users,
} from "@workspace/db";
import qaqcRouter from "../src/routes/qaqc";
import auditRouter from "../src/routes/audit";
import { issueToken } from "../src/lib/auth";

let app: Express;
let server: Server;
let baseUrl: string;
let adminToken: string;
let organizationId: string;
let foreignOrganizationId: string;
let activeUserId: string;
let deactivatedUserId: string;
let foreignUserId: string;

const suffix = Math.random().toString(36).slice(2, 8);

async function listDelegations(appKey: "qaqc" | "audit") {
  const response = await fetch(`${baseUrl}/${appKey}/admin/delegations?page=1&limit=20`, {
    headers: { authorization: `Bearer ${adminToken}` },
  });
  return { status: response.status, json: await response.json() };
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  app.use("/qaqc", qaqcRouter);
  app.use("/audit", auditRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;

  const [organization, foreignOrganization] = await db.insert(organizations).values([
    { name: `Delegation identities ${suffix}`, code: `DI${suffix}` },
    { name: `Foreign delegation identities ${suffix}`, code: `DFI${suffix}` },
  ]).returning();
  organizationId = organization!.id;
  foreignOrganizationId = foreignOrganization!.id;

  const [adminRole] = await db.insert(platformRoles).values({
    organizationId,
    name: "Org Admin",
    isSystem: true,
  }).returning();
  const [admin, activeUser, deactivatedUser, foreignUser] = await db.insert(users).values([
    {
      organizationId,
      platformRoleId: adminRole!.id,
      username: `admin.${suffix}`,
      email: `admin.${suffix}@example.test`,
      fullName: "Delegation Identity Administrator",
    },
    {
      organizationId,
      username: `active.${suffix}`,
      email: `active.${suffix}@example.test`,
      fullName: "Active Delegator",
    },
    {
      organizationId,
      username: `inactive.${suffix}`,
      email: `inactive.${suffix}@example.test`,
      fullName: "Former Delegate",
      accessStatus: "deactivated",
      deletedAt: new Date(),
    },
    {
      organizationId: foreignOrganizationId,
      username: `foreign.${suffix}`,
      email: `foreign.${suffix}@example.test`,
      fullName: "Foreign User Must Stay Hidden",
    },
  ]).returning();
  adminToken = issueToken(admin!);
  activeUserId = activeUser!.id;
  deactivatedUserId = deactivatedUser!.id;
  foreignUserId = foreignUser!.id;

  const rows = [
    {
      organizationId,
      delegatorId: activeUserId,
      delegateId: deactivatedUserId,
      startsAt: new Date("2026-01-01"),
      endsAt: new Date("2026-12-31"),
      scope: { scope: "all" },
      status: "active",
    },
    {
      organizationId,
      delegatorId: activeUserId,
      delegateId: foreignUserId,
      startsAt: new Date("2026-01-01"),
      endsAt: new Date("2026-12-31"),
      scope: { scope: "all" },
      status: "active",
    },
  ];
  await db.insert(delegations).values(rows);
  await db.insert(auditDelegations).values(rows);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.delete(auditDelegations).where(eq(auditDelegations.organizationId, organizationId));
  await db.delete(delegations).where(eq(delegations.organizationId, organizationId));
  await db.delete(users).where(inArray(users.organizationId, [organizationId, foreignOrganizationId]));
  await db.delete(platformRoles).where(eq(platformRoles.organizationId, organizationId));
  await db.delete(organizations).where(inArray(organizations.id, [organizationId, foreignOrganizationId]));
});

describe("delegation identity summaries", () => {
  for (const appKey of ["qaqc", "audit"] as const) {
    it(`returns safe tenant-scoped identities from the ${appKey} delegation list`, async () => {
      const result = await listDelegations(appKey);
      expect(result.status).toBe(200);

      const deactivated = result.json.items.find((row: { delegateId: string }) => row.delegateId === deactivatedUserId);
      expect(deactivated).toMatchObject({
        delegatorId: activeUserId,
        delegatorFullName: "Active Delegator",
        delegatorUsername: `active.${suffix}`,
        delegatorEmail: `active.${suffix}@example.test`,
        delegatorUserStatus: "active",
        delegateFullName: "Former Delegate",
        delegateUsername: `inactive.${suffix}`,
        delegateEmail: `inactive.${suffix}@example.test`,
        delegateUserStatus: "deactivated",
      });

      const unavailable = result.json.items.find((row: { delegateId: string }) => row.delegateId === foreignUserId);
      expect(unavailable).toMatchObject({
        delegatorFullName: "Active Delegator",
        delegateFullName: null,
        delegateUsername: null,
        delegateEmail: null,
        delegateUserStatus: "unavailable",
      });
      expect(JSON.stringify(unavailable)).not.toContain("Foreign User Must Stay Hidden");
      expect(JSON.stringify(unavailable)).not.toContain(`foreign.${suffix}@example.test`);
    });
  }
});