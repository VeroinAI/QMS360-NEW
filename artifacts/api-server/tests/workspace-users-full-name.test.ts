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
let tailUserId: string;

const suffix = Math.random().toString(36).slice(2, 8);

async function listUsers(appKey: "qaqc" | "lessons" | "audit", params = "page=1&limit=20") {
  const response = await fetch(`${baseUrl}/${appKey}/admin/users?${params}`, {
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
  await db.insert(users).values(Array.from({ length: 42 }, (_, i) => ({
    organizationId, username: `zz.fixture.${suffix}.${String(i).padStart(2, "0")}`,
    email: `fixture.${suffix}.${i}@example.test`, fullName: `Z Fixture user ${String(i).padStart(2, "0")}`,
  })));
  const [tail] = await db.insert(users).values({
    organizationId, username: `zzzz.tail.${suffix}`, email: `tail.${suffix}@example.test`, fullName: "ZZ Tail User",
  }).returning();
  tailUserId = tail!.id;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.delete(users).where(eq(users.organizationId, organizationId));
  await db.delete(platformRoles).where(eq(platformRoles.organizationId, organizationId));
  await db.delete(organizations).where(eq(organizations.id, organizationId));
});

describe("workspace user full names", () => {
  for (const appKey of ["qaqc", "lessons", "audit"] as const) {
    it(`paginates all 45 authorized ${appKey} users without missing or duplicating records`, async () => {
      const pages = await Promise.all([1, 2, 3].map(page => listUsers(appKey, `page=${page}&limit=20`)));
      expect(pages.map(result => result.status)).toEqual([200, 200, 200]);
      expect(pages.map(result => result.json.total)).toEqual([45, 45, 45]);
      expect(pages.map(result => result.json.items.length)).toEqual([20, 20, 5]);
      const ids = pages.flatMap(result => result.json.items.map((user: { id: string }) => user.id));
      expect(new Set(ids).size).toBe(45);
      expect(pages[0]!.json.items.some((user: { id: string }) => user.id === tailUserId)).toBe(false);
      expect(pages[2]!.json.items.some((user: { id: string }) => user.id === tailUserId)).toBe(true);
    });
    it(`searches beyond page 1 and counts only matching ${appKey} users`, async () => {
      for (const search of ["  zz TAIL user  ", `tail.${suffix}@example.test`, `zzzz.tail.${suffix}`]) {
        const result = await listUsers(appKey, `page=1&limit=20&search=${encodeURIComponent(search)}`);
        expect(result.status).toBe(200);
        expect(result.json.total).toBe(1);
        expect(result.json.items.map((user: { id: string }) => user.id)).toEqual([tailUserId]);
      }
      const none = await listUsers(appKey, "page=1&limit=20&search=absent-user-record");
      expect(none.json).toMatchObject({ items: [], total: 0 });
      const blank = await listUsers(appKey, "page=1&limit=20&search=%20%20");
      expect(blank.json.total).toBe(45);
      const matchingPage = await listUsers(appKey, "page=2&limit=20&search=Z%20Fixture");
      expect(matchingPage.json.total).toBe(42);
      expect(matchingPage.json.items).toHaveLength(20);
    });
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