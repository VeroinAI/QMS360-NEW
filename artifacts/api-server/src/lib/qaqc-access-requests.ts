import type { Request } from "express";
import { db } from "@workspace/db";
import { loadPendingApplicationRequests, pendingApplicationRequests, type Access, type Member } from "./application-access-requests";

export type QaqcAccessRequest = ReturnType<typeof pendingApplicationRequests>[number];

export const pendingQaqcRequests = (access: Access[], members: Member[], visible: (projects: string[], units?: string[]) => boolean) =>
  pendingApplicationRequests("qaqc", access, members, visible);

export const loadPendingQaqcRequests = (req: Request, executor: Pick<typeof db, "select"> = db) =>
  loadPendingApplicationRequests(req, "qaqc", executor);