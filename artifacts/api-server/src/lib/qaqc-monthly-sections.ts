import type { Request } from "express";
import { monthlySections, canMaintainMonthlyField } from "@workspace/field-controls";
import { getAuthorizedProjectScope } from "../middlewares/rbac";
import { HttpError } from "./workspace";

const accessCache = new WeakMap<Request, Map<string, Promise<string[]>>>();
export function monthlySectionAccess(req: Request, projectId: string): Promise<string[]> {
  let projects = accessCache.get(req);
  if (!projects) { projects = new Map(); accessCache.set(req, projects); }
  let pending = projects.get(projectId);
  if (!pending) { pending = resolveSectionAccess(req, projectId); projects.set(projectId, pending); }
  return pending;
}
async function resolveSectionAccess(req: Request, projectId: string) {
  const base = await getAuthorizedProjectScope(req, "qaqc", { module: "monthly_reports", action: "own", operation: "create_edit" });
  if (!base.unrestricted && !base.projectIds.includes(projectId)) return [];
  const sections = await Promise.all(monthlySections.filter(s => s.id !== "pqi").map(async s => {
    const scope = await getAuthorizedProjectScope(req, "qaqc", { module: `monthly_section_${s.id}`, action: "own" });
    return scope.unrestricted || scope.projectIds.includes(projectId) ? s.id : null;
  }));
  return sections.filter((s): s is NonNullable<typeof s> => s !== null);
}

export function mergeMonthlySections(current: Record<string, any>, requested: Record<string, any>, allowed: readonly string[]) {
  const merged = structuredClone(current);
  for (const [key, value] of Object.entries(requested)) {
    if (canMaintainMonthlyField(key, allowed)) merged[key] = value;
    else if (JSON.stringify(current[key]) !== JSON.stringify(value))
      throw new HttpError(403, `You cannot maintain the monthly report section for "${key}"`);
  }
  // Any source change invalidates the assessment, even when the contributor cannot edit the brief.
  if (Object.entries(requested).some(([key, value]) => key !== "assessmentConfirmed" && JSON.stringify(current[key]) !== JSON.stringify(value)))
    {
      merged.assessmentConfirmed = allowed.includes("assessment") && requested.assessmentConfirmed === true;
      merged.noUpdates = requested.noUpdates === true;
    }
  return merged;
}
