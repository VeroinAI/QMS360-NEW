import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import {
  auditUserWorkspaceRoles,
  auditWorkspaceRoles,
  db,
  lessonsUserWorkspaceRoles,
  lessonsWorkspaceRoles,
  organizations,
  platformRoles,
  userWorkspaceRoles,
  users,
  workspaceRoles,
} from "@workspace/db";

const jwtSecret = (() => {
  const secret = process.env.JWT_SECRET ?? process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET or SESSION_SECRET must be configured");
  }
  return secret;
})();

export type AuthToken = { sub: string; organizationId: string };

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

export function issueToken(user: { id: string; organizationId: string }): string {
  return jwt.sign({ sub: user.id, organizationId: user.organizationId }, jwtSecret, { expiresIn: "8h" });
}

export function verifyToken(token: string): AuthToken {
  const decoded = jwt.verify(token, jwtSecret);
  if (typeof decoded === "string" || typeof decoded.sub !== "string" || typeof decoded.organizationId !== "string") {
    throw new Error("Invalid token payload");
  }
  return { sub: decoded.sub, organizationId: decoded.organizationId };
}

export async function getUserContext(userId: string) {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      username: users.username,
      fullName: users.fullName,
      organizationId: users.organizationId,
      organizationName: organizations.name,
      platformRole: platformRoles.name,
    })
    .from(users)
    .innerJoin(organizations, eq(users.organizationId, organizations.id))
    .leftJoin(platformRoles, eq(users.platformRoleId, platformRoles.id))
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    return null;
  }

  const [qaqcRoleRows, lessonRoleRows, auditRoleRows] = await Promise.all([
    db.select({ name: workspaceRoles.name })
      .from(userWorkspaceRoles)
      .innerJoin(workspaceRoles, eq(userWorkspaceRoles.workspaceRoleId, workspaceRoles.id))
      .where(eq(userWorkspaceRoles.userId, userId)),
    db.select({ name: lessonsWorkspaceRoles.name })
      .from(lessonsUserWorkspaceRoles)
      .innerJoin(lessonsWorkspaceRoles, eq(lessonsUserWorkspaceRoles.workspaceRoleId, lessonsWorkspaceRoles.id))
      .where(eq(lessonsUserWorkspaceRoles.userId, userId)),
    db.select({ name: auditWorkspaceRoles.name })
      .from(auditUserWorkspaceRoles)
      .innerJoin(auditWorkspaceRoles, eq(auditUserWorkspaceRoles.workspaceRoleId, auditWorkspaceRoles.id))
      .where(eq(auditUserWorkspaceRoles.userId, userId)),
  ]);
  const roleRows = [...qaqcRoleRows, ...lessonRoleRows, ...auditRoleRows];

  return {
    id: user.id,
    email: user.email,
    username: user.username,
    fullName: user.fullName,
    platformRole: user.platformRole ?? "Employee",
    organizationName: user.organizationName,
    workspaceRoles: roleRows.map((row) => row.name),
    organizationId: user.organizationId,
  };
}

export async function ensureOrganization() {
  const [existing] = await db.select().from(organizations).limit(1);
  if (existing) {
    return existing;
  }
  const [created] = await db.insert(organizations).values({
    name: "Algihaz Holding",
    code: "AGH",
    timezone: "Asia/Riyadh",
    locale: "en",
    branding: {
      primaryBlack: "#3A3A3B",
      primaryPurple: "#582C83",
      secondaryYellow: "#EB9823",
      secondaryTurquoise: "#06AEBB",
      secondaryFuchsia: "#A43C96",
    },
  }).returning();
  return created;
}