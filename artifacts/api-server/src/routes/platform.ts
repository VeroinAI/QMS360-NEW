import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { GetPlatformContextResponse, ListProjectsResponse } from "@workspace/api-zod";
import { businessUnits, db, organizations, projects, workspaceRoles, userWorkspaceRoles } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

const appDefinitions = [
  {
    key: "qaqc" as const,
    name: "QA/QC & Document Governance",
    shortName: "QA / QC",
    description: "Project quality metrics, inspections, and document control.",
    accent: "purple",
  },
  {
    key: "lessons" as const,
    name: "Lesson Learned Management",
    shortName: "Lessons",
    description: "Capture field insight and turn experience into a searchable standard.",
    accent: "turquoise",
  },
  {
    key: "audit" as const,
    name: "QMS Audit Management",
    shortName: "Audits",
    description: "Plan, execute, and close the full ISO 9001 internal audit lifecycle.",
    accent: "yellow",
  },
];

function userHasAppAccess(platformRole: string, roleNames: string[], appKey: string): boolean {
  if (["Super Admin", "Org Admin", "Executive Viewer", "Quality Manager"].includes(platformRole)) {
    return true;
  }
  const roleText = roleNames.join(" ");
  if (appKey === "qaqc") return roleText.includes("QAQC") || roleText.includes("Document");
  if (appKey === "lessons") return roleText.includes("Form ");
  return roleText.includes("Audit") || roleText.includes("Process");
}

router.get("/platform/context", requireAuth, async (req, res): Promise<void> => {
  const user = req.currentUser;
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const [organization] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, user.organizationId)).limit(1);
  const roleRows = await db
    .select({ name: workspaceRoles.name })
    .from(userWorkspaceRoles)
    .innerJoin(workspaceRoles, eq(userWorkspaceRoles.workspaceRoleId, workspaceRoles.id))
    .where(eq(userWorkspaceRoles.userId, user.id));
  const roleNames = roleRows.map((row) => row.name);
  const projectRows = await db
    .select({
      id: projects.id,
      code: projects.code,
      name: projects.name,
      businessUnit: businessUnits.name,
      status: projects.status,
      location: projects.location,
    })
    .from(projects)
    .leftJoin(businessUnits, eq(projects.businessUnitId, businessUnits.id))
    .where(eq(projects.organizationId, user.organizationId));

  const response = {
    organizationName: organization?.name ?? user.organizationName,
    apps: appDefinitions.map((app) => ({
      ...app,
      workspaceRoleCount: roleNames.filter((name) => userHasAppAccess(user.platformRole, [name], app.key)).length,
      hasAccess: userHasAppAccess(user.platformRole, roleNames, app.key),
    })),
    projects: projectRows.map((project) => ({
      ...project,
      businessUnit: project.businessUnit ?? "Unassigned",
    })),
  };
  res.json(GetPlatformContextResponse.parse(response));
});

router.get("/projects", requireAuth, async (req, res): Promise<void> => {
  const user = req.currentUser;
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const projectRows = await db
    .select({
      id: projects.id,
      code: projects.code,
      name: projects.name,
      businessUnit: businessUnits.name,
      status: projects.status,
      location: projects.location,
    })
    .from(projects)
    .leftJoin(businessUnits, eq(projects.businessUnitId, businessUnits.id))
    .where(eq(projects.organizationId, user.organizationId));
  res.json(ListProjectsResponse.parse(projectRows.map((project) => ({
    ...project,
    businessUnit: project.businessUnit ?? "Unassigned",
  }))));
});

export { appDefinitions, userHasAppAccess };
export default router;