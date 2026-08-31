import type { NextFunction, Request, Response } from "express";
import { getUserContext, verifyToken, type AuthToken } from "../lib/auth";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthToken;
      currentUser?: Awaited<ReturnType<typeof getUserContext>>;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const token = verifyToken(header.slice("Bearer ".length));
    const user = await getUserContext(token.sub);
    if (!user || user.organizationId !== token.organizationId) {
      res.status(401).json({ error: "Invalid session" });
      return;
    }
    req.auth = token;
    req.currentUser = user;
    next();
  } catch (error) {
    req.log.warn({ error }, "Rejected invalid authentication token");
    res.status(401).json({ error: "Invalid session" });
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