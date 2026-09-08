import { Router, type IRouter } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { eq, and } from "drizzle-orm";
import {
  ContainerSsoBody,
  ChangePasswordBody,
  ChangePasswordResponse,
  GetCurrentUserResponse,
  LoginBody,
  LoginResponse,
  RegisterBody,
  RegisterResponse,
} from "@workspace/api-zod";
import { db, users, platformRoles } from "@workspace/db";
import { ensureOrganization, getUserContext, hashPassword, issueToken, verifyPassword } from "../lib/auth";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [user] = await db.select({
    id: users.id,
    organizationId: users.organizationId,
    passwordHash: users.passwordHash,
  }).from(users).where(eq(users.email, parsed.data.email.toLowerCase())).limit(1);
  if (!user?.passwordHash || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    res.status(401).json({ error: "Email or password is incorrect" });
    return;
  }

  await db.update(users).set({ lastAccessAt: new Date() }).where(eq(users.id, user.id));
  const context = await getUserContext(user.id);
  if (!context) {
    res.status(401).json({ error: "Unable to load user context" });
    return;
  }
  const response = LoginResponse.parse({ token: issueToken(user), user: context });
  res.json(response);
});

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const organization = await ensureOrganization();
  const [existing] = await db.select({ id: users.id }).from(users).where(
    and(eq(users.organizationId, organization.id), eq(users.email, parsed.data.email.toLowerCase())),
  ).limit(1);
  if (existing) {
    res.status(409).json({ error: "Email already registered" });
    return;
  }
  const [employeeRole] = await db.select().from(platformRoles).where(
    and(eq(platformRoles.organizationId, organization.id), eq(platformRoles.name, "Employee")),
  ).limit(1);
  const [user] = await db.insert(users).values({
    organizationId: organization.id,
    platformRoleId: employeeRole?.id,
    email: parsed.data.email.toLowerCase(),
    username: parsed.data.username ?? parsed.data.email.split("@")[0],
    fullName: parsed.data.fullName,
    passwordHash: await hashPassword(parsed.data.password),
    authSource: "local",
  }).returning();
  const context = await getUserContext(user.id);
  if (!context) {
    res.status(500).json({ error: "Unable to create user context" });
    return;
  }
  const response = RegisterResponse.parse({ token: issueToken(user), user: context });
  res.status(201).json(response);
});

router.post("/auth/sso", async (req, res): Promise<void> => {
  if ((process.env.AUTH_STRATEGY ?? "local") !== "container") {
    res.status(501).json({ error: "Container auth strategy is disabled in this environment" });
    return;
  }
  // The container bridge, not an end user, is the identity authority. Its
  // shared secret must be authenticated before any caller-provided identity is used.
  const secret = process.env.SSO_BRIDGE_SECRET;
  if (!secret) {
    res.status(503).json({ error: "Container SSO bridge is not configured" });
    return;
  }
  const supplied = req.header("x-qms-bridge-token") ?? "";
  const expectedBuffer = createHash("sha256").update(secret).digest();
  const suppliedBuffer = createHash("sha256").update(supplied).digest();
  if (!timingSafeEqual(expectedBuffer, suppliedBuffer)) {
    res.status(401).json({ error: "Invalid container SSO bridge token" });
    return;
  }
  const parsed = ContainerSsoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const organization = await ensureOrganization();
  const email = parsed.data.email?.toLowerCase() ?? `${parsed.data.username}@container.algihaz`;
  let [user] = await db.select().from(users).where(
    and(eq(users.organizationId, organization.id), eq(users.username, parsed.data.username)),
  ).limit(1);
  if (!user) {
    [user] = await db.insert(users).values({
      organizationId: organization.id,
      email,
      username: parsed.data.username,
      fullName: parsed.data.fullName ?? parsed.data.username,
      authSource: "container",
    }).returning();
  }
  const context = await getUserContext(user.id);
  if (!context) {
    res.status(500).json({ error: "Unable to load user context" });
    return;
  }
  res.json(LoginResponse.parse({ token: issueToken(user), user: context }));
});

router.get("/auth/me", requireAuth, (req, res): void => {
  if (!req.currentUser) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  res.json(GetCurrentUserResponse.parse(req.currentUser));
});

router.put("/auth/change-password", requireAuth, async (req, res): Promise<void> => {
  const parsed = ChangePasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: parsed.error.message });
    return;
  }
  await db.update(users).set({
    passwordHash: await hashPassword(parsed.data.password),
    updatedAt: new Date(),
  }).where(eq(users.id, req.currentUser!.id));
  const context = await getUserContext(req.currentUser!.id);
  if (!context) {
    res.status(401).json({ error: "Unable to load user context" });
    return;
  }
  res.json(ChangePasswordResponse.parse(context));
});

export default router;