import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import {
  db, organizations, platformRoles, users,
} from "@workspace/db";
import qaqcRouter from "../src/routes/qaqc";
import lessonsRouter from "../src/routes/lessons";
import auditRouter from "../src/routes/audit";
import { issueToken } from "../src/lib/auth";

let app: Express;
let server: Server;
let baseUrl: string;
let organizationId: string;
let adminToken: string;
let expectedUserId: string;

const suffix = Math.random().toString(36).slice(2, 8);

async function listUsers(appKey: "qaqc" | "lessons" | "audit") {
  const response = await fetch(`${baseUrl}/${appKey}/admin/users?page=1&limit=20`, {
    headers: { authorization: `Bearer ${adminToken}` },
  });
  return { status: response.status, json: await response.json() };
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  app.use("/qaqc", qaqcRouter);
  app.use("/lessons", lessonsRouter);
  app.use("/audit", auditRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (typeof address === "string" || !address) throw new Error("Failed to bind test server");
  baseUrl = `http://127.0.0.1:${address.port}`;

  const [organization] = await db.insert(organizations).values({
    name: `Workspace user names ${suffix}`,
    code: `WUN${suffix}`,
  }).returning();
  organizationId = organization!.id;

  const [adminRole] = await db.insert(platformRoles).values({
    organizationId,
    name: "Org Admin",
    isSystem: true,
  }).returning();
  const [admin] = await db.insert(users).values({
    organizationId,
    platformRoleId: adminRole!.id,
    username: `admin.${suffix}`,
    email: `admin.${suffix}@example.test`,
    fullName: "Workspace Names Administrator",
  }).returning();
  adminToken = issueToken(admin!);

  const [target] = await db.insert(users).values({
    organizationId,
    username: `quality.user.${suffix}`,
    email: `quality.user.${suffix}@example.test`,
    fullName: "Quality User Full Name",
  }).returning();
  expectedUserId = target!.id;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.delete(users).where(eq(users.organizationId, organizationId));
  await db.delete(platformRoles).where(eq(platformRoles.organizationId, organizationId));
  await db.delete(organizations).where(eq(organizations.id, organizationId));
});

describe("workspace user full names", () => {
  for (const appKey of ["qaqc", "lessons", "audit"] as const) {
    it(`returns fullName from the ${appKey} administration user list`, async () => {
      const result = await listUsers(appKey);
      expect(result.status).toBe(200);
      expect(result.json.items).toContainEqual(expect.objectContaining({
        id: expectedUserId,
        username: `quality.user.${suffix}`,
        email: `quality.user.${suffix}@example.test`,
        fullName: "Quality User Full Name",
      }));
    });
  }
});