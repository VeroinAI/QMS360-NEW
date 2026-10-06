import type { NextFunction, Request, Response } from "express";
import { getUserContext, verifyToken, type AuthToken } from "../lib/auth";
import { authenticationConfiguration, authenticationUnavailableMessage } from "../lib/drona/activation";
import { DronaAccessError, dronaSessionProjects } from "../lib/drona/session";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthToken;
      currentUser?: Awaited<ReturnType<typeof getUserContext>>;
      dronaProjectIds?: string[];
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const unavailable = authenticationUnavailableMessage(process.env.AUTH_STRATEGY);
  if (unavailable) {
    // Old local/admin tokens cannot bypass an incomplete Drona activation.
    res.status(503).json({ error: unavailable });
    return;
  }
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const token = verifyToken(header.slice("Bearer ".length));
    const dronaMode = authenticationConfiguration(process.env.AUTH_STRATEGY).mode === "drona";
    if (dronaMode) {
      if (token.source !== "drona-email-exception" || token.environment !== process.env.DRONA_ENVIRONMENT
        || token.organizationId !== process.env.DRONA_ORGANIZATION_ID || !token.externalUserId) {
        res.status(401).json({ error: "A current Drona exception session is required" });
        return;
      }
      try {
        req.dronaProjectIds = await dronaSessionProjects({
          id: token.sub, organizationId: token.organizationId, externalUserId: token.externalUserId,
        });
      } catch (error) {
        if (error instanceof DronaAccessError) throw error;
        res.status(503).json({ error: "Drona account/project data is currently unavailable" });
        return;
      }
    } else if (token.source === "drona-email-exception") {
      res.status(401).json({ error: "Drona sessions are not enabled in this environment" });
      return;
    }
    const user = await getUserContext(token.sub);
    if (!user || user.organizationId !== token.organizationId) {
      res.status(401).json({ error: "Invalid session" });
      return;
    }
    req.auth = token;
    req.currentUser = user;
    next();
  } catch (error) {
    req.log?.warn({ error }, "Rejected invalid authentication token");
    if (error instanceof DronaAccessError) res.status(error.status).json({ error: error.message });
    else res.status(401).json({ error: "Invalid session or unavailable Drona identity data" });
  }
}

export function requirePlatformRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.currentUser || !roles.includes(req.currentUser.platformRole)) {
      res.status(403).json({ error: "This action is not permitted for your role" });
      return;
    }
    next();
  };
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const user = req.currentUser;
  const platformAdmins = ["Super Admin", "Org Admin"];
  if (!user || !platformAdmins.includes(user.platformRole)) {
    res.status(403).json({ error: "Administrator access is required" });
    return;
  }
  next();
}