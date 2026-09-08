import { Router, type IRouter } from "express";
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import {
  GetApplicationAccessResponse, GetFieldSettingsResponse, GetNumberingConfigResponse, GetOrganizationSettingsResponse,
  GetPlatformContextResponse, GetPlatformReferenceDataResponse,
  ListBusinessUnitsResponse, ListProjectsResponse, ResetNumberingPatternResponse,
  SetUserTemporaryPasswordBody,
  UpdateFieldSettingsBody, UpdateFieldSettingsResponse, UpdateNumberingPatternBody, UpdateNumberingPatternResponse, UpdateOrganizationSettingsBody,
  UpdateOrganizationSettingsResponse,
} from "@workspace/api-zod";
import { applicationAccess, businessUnits, db, moduleFieldSettings, organizations, organizationSettings, projects, users } from "@workspace/db";
import { requireAdmin, requireAuth } from "../middlewares/auth";
import { hashPassword } from "../lib/auth";
import { runEscalationSweep } from "../lib/escalation";
import { paginated, pagination, type AppKey } from "../lib/workspace";
import { catalogKeys, FIELD_CATALOG } from "../lib/field-access";
import {
  effectivePattern, formatReferenceNumber, getNumberingMap, isConfigured, NUMBERING_MODULES,
  resetNumberingPattern, saveNumberingPattern, type NumberingModule,
} from "../lib/numbering";

const router: IRouter = Router();

router.put("/platform/users/:userId/temporary-password", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const parsed = SetUserTemporaryPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: parsed.error.message });
    return;
  }
  const [updated] = await db.update(users).set({
    passwordHash: await hashPassword(parsed.data.password),
    authSource: "local",
    updatedAt: new Date(),
  }).where(and(
    eq(users.id, String(req.params.userId)),
    eq(users.organizationId, req.currentUser!.organizationId),
    isNull(users.deletedAt),
  )).returning({ id: users.id });
  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.status(204).send();
});

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
  const [access] = await db.select().from(applicationAccess)
    .where(and(
      eq(applicationAccess.organizationId, user.organizationId),
      eq(applicationAccess.username, user.username),
    ))
    .limit(1);
  const roleNames = user.workspaceRoles;
  const accessByApp = {
    qaqc: access?.canOpenQaqc ?? false,
    lessons: access?.canOpenLessons ?? false,
    audit: access?.canOpenAudit ?? false,
  };
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
      hasAccess: accessByApp[app.key],
    })),
    projects: projectRows.map((project) => ({
      ...project,
      businessUnit: project.businessUnit ?? "Unassigned",
    })),
  };
  res.json(GetPlatformContextResponse.parse(response));
});

router.get("/platform/projects", requireAuth, async (req, res): Promise<void> => {
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

router.get("/platform/business-units", requireAuth, async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const { page, limit, offset } = pagination(req);
  const where = and(eq(businessUnits.organizationId, user.organizationId), isNull(businessUnits.deletedAt));
  const [rows, countRows] = await Promise.all([
    db.select().from(businessUnits).where(where).orderBy(businessUnits.name).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(businessUnits).where(where),
  ]);
  const projectRows = await db.select({ id: projects.id, businessUnitId: projects.businessUnitId })
    .from(projects).where(and(eq(projects.organizationId, user.organizationId), isNull(projects.deletedAt)));
  const response = paginated(rows.map((row) => ({
    id: row.id, name: row.name, parentGroup: row.headName,
    projectIds: projectRows.filter((project) => project.businessUnitId === row.id).map((project) => project.id),
  })), Number(countRows[0]?.count ?? 0), page, limit);
  res.json(ListBusinessUnitsResponse.parse(response));
});

router.get("/platform/application-access", requireAuth, async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const rows = await db.select().from(applicationAccess).where(and(
    eq(applicationAccess.organizationId, user.organizationId),
    eq(applicationAccess.username, user.username), isNull(applicationAccess.deletedAt),
  ));
  res.json(GetApplicationAccessResponse.parse({
    qaqc: rows.some((row) => row.canOpenQaqc),
    lessons: rows.some((row) => row.canOpenLessons),
    audit: rows.some((row) => row.canOpenAudit),
  }));
});

router.get("/platform/reference-data", requireAuth, async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const since = typeof req.query.since === "string" ? new Date(req.query.since) : null;
  if (since && Number.isNaN(since.valueOf())) { res.status(422).json({ error: "Invalid since timestamp" }); return; }
  const updated = since ? gt(projects.updatedAt, since) : undefined;
  const [projectRows, unitRows] = await Promise.all([
    db.select({
      id: projects.id, code: projects.code, name: projects.name, status: projects.status,
      location: projects.location, businessUnit: businessUnits.name,
    }).from(projects).leftJoin(businessUnits, eq(projects.businessUnitId, businessUnits.id))
      .where(and(eq(projects.organizationId, user.organizationId), isNull(projects.deletedAt), updated)),
    db.select().from(businessUnits).where(and(
      eq(businessUnits.organizationId, user.organizationId), isNull(businessUnits.deletedAt),
      since ? gt(businessUnits.updatedAt, since) : undefined,
    )),
  ]);
  const allProjects = await db.select({ id: projects.id, businessUnitId: projects.businessUnitId })
    .from(projects).where(and(eq(projects.organizationId, user.organizationId), isNull(projects.deletedAt)));
  res.json(GetPlatformReferenceDataResponse.parse({
    generatedAt: new Date(),
    projects: projectRows.map((row) => ({ ...row, businessUnit: row.businessUnit ?? "Unassigned" })),
    businessUnits: unitRows.map((row) => ({
      id: row.id, name: row.name, parentGroup: row.headName,
      projectIds: allProjects.filter((project) => project.businessUnitId === row.id).map((project) => project.id),
    })),
  }));
});

const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function settingsResponse(org: typeof organizations.$inferSelect, settings?: typeof organizationSettings.$inferSelect) {
  const branding = settings?.branding ?? {};
  const limits = settings?.evidenceLimits;
  return {
    organizationName: org.name,
    logoUrl: typeof branding.logoUrl === "string" ? branding.logoUrl : null,
    primaryColor: typeof branding.primaryColor === "string" ? branding.primaryColor : undefined,
    locale: settings?.locale ?? org.locale,
    timezone: settings?.timezone ?? org.timezone,
    workingCalendar: {
      workingDays: (settings?.workingCalendar.workingDays ?? []).map((day) => dayNames.indexOf(day)).filter((day) => day >= 0),
      holidays: (settings?.workingCalendar.holidays ?? []).map((date) => new Date(date)),
    },
    exportRowThreshold: settings?.exportThresholdRows,
    exportMonthThreshold: settings?.exportThresholdMonths,
    evidenceLimits: limits ? {
      photoMaxBytes: limits.photoMaxMb * 1024 * 1024,
      photoMaxCount: limits.lessonPhotoCountMax,
      videoMaxBytes: limits.videoMaxMb * 1024 * 1024,
      videoMaxDurationSeconds: limits.videoMaxMinutes * 60,
      documentMaxBytes: limits.docMaxMb * 1024 * 1024,
    } : undefined,
    allowedEmailDomains: settings?.allowedEmailDomains,
  };
}

// Admin-triggered escalation sweep — runs the same evaluation the 15-minute
// scheduler performs, so admins can verify rules without waiting for the
// interval. Scoped to the caller's organization (a tenant admin can never
// trigger escalation work for other tenants) and serialized with the
// scheduler via the shared in-flight guard, so overlapping manual/scheduled
// sweeps cannot double-advance an instance or duplicate notifications.
// Returns the per-app count of new escalation instances created.
router.post("/platform/escalations/sweep", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const created = await runEscalationSweep(req.currentUser!.organizationId);
  if (created === null) {
    res.status(409).json({ error: "An escalation sweep is already in progress; try again shortly" });
    return;
  }
  res.json({ ranAt: new Date(), created });
});

router.get("/platform/organization-settings", requireAuth, async (req, res): Promise<void> => {
  const user = req.currentUser!;
  const [org] = await db.select().from(organizations).where(eq(organizations.id, user.organizationId)).limit(1);
  const [settings] = await db.select().from(organizationSettings).where(and(
    eq(organizationSettings.organizationId, user.organizationId), isNull(organizationSettings.deletedAt),
  )).limit(1);
  res.json(GetOrganizationSettingsResponse.parse(settingsResponse(org!, settings)));
});

router.put("/platform/organization-settings", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const parsed = UpdateOrganizationSettingsBody.safeParse(req.body);
  if (!parsed.success) { res.status(422).json({ error: parsed.error.issues[0]?.message ?? "Invalid settings" }); return; }
  const user = req.currentUser!;
  const body = parsed.data;
  await db.update(organizations).set({
    name: body.organizationName, locale: body.locale, timezone: body.timezone, updatedAt: new Date(),
  }).where(eq(organizations.id, user.organizationId));
  const evidenceLimits = body.evidenceLimits ? {
    photoMaxMb: Math.floor((body.evidenceLimits.photoMaxBytes ?? 8 * 1024 * 1024) / 1024 / 1024),
    photoMaxWidth: 1920, photoMaxHeight: 1080,
    videoMaxMb: Math.floor((body.evidenceLimits.videoMaxBytes ?? 200 * 1024 * 1024) / 1024 / 1024),
    videoMaxMinutes: Math.floor((body.evidenceLimits.videoMaxDurationSeconds ?? 180) / 60),
    docMaxMb: Math.floor((body.evidenceLimits.documentMaxBytes ?? 25 * 1024 * 1024) / 1024 / 1024),
    lessonPhotoCountMax: body.evidenceLimits.photoMaxCount ?? 5,
  } : undefined;
  const values = {
    organizationId: user.organizationId,
    branding: { ...(body.logoUrl ? { logoUrl: body.logoUrl } : {}), ...(body.primaryColor ? { primaryColor: body.primaryColor } : {}) },
    locale: body.locale, timezone: body.timezone,
    workingCalendar: {
      workingDays: body.workingCalendar.workingDays.map((day) => dayNames[day]!),
      holidays: body.workingCalendar.holidays.map((day) => day.toISOString().slice(0, 10)),
    },
    allowedEmailDomains: body.allowedEmailDomains ?? [],
    exportThresholdRows: body.exportRowThreshold ?? 10000,
    exportThresholdMonths: body.exportMonthThreshold ?? 6,
    ...(evidenceLimits ? { evidenceLimits } : {}),
    updatedAt: new Date(),
  };
  const [existing] = await db.select({ id: organizationSettings.id }).from(organizationSettings)
    .where(and(eq(organizationSettings.organizationId, user.organizationId), isNull(organizationSettings.deletedAt))).limit(1);
  if (existing) await db.update(organizationSettings).set(values).where(eq(organizationSettings.id, existing.id));
  else await db.insert(organizationSettings).values(values);
  const [org] = await db.select().from(organizations).where(eq(organizations.id, user.organizationId)).limit(1);
  const [settings] = await db.select().from(organizationSettings).where(and(
    eq(organizationSettings.organizationId, user.organizationId), isNull(organizationSettings.deletedAt),
  )).limit(1);
  res.json(UpdateOrganizationSettingsResponse.parse(settingsResponse(org!, settings)));
});

const moduleConfigDto = (map: Awaited<ReturnType<typeof getNumberingMap>>, module: NumberingModule) => {
  const pattern = effectivePattern(map, module);
  return { pattern, configured: isConfigured(map, module), preview: formatReferenceNumber(pattern, pattern.nextNumber) };
};

router.get("/platform/numbering", requireAuth, async (req, res): Promise<void> => {
  const map = await getNumberingMap(req.currentUser!.organizationId);
  const modules = Object.fromEntries(NUMBERING_MODULES.map((module) => [module, moduleConfigDto(map, module)]));
  res.json(GetNumberingConfigResponse.parse({ modules }));
});

router.put("/platform/numbering/:module", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const module = String(req.params.module) as NumberingModule;
  if (!NUMBERING_MODULES.includes(module)) { res.status(404).json({ error: "Unknown module" }); return; }
  const parsed = UpdateNumberingPatternBody.safeParse(req.body);
  if (!parsed.success) { res.status(422).json({ error: parsed.error.issues[0]?.message ?? "Invalid numbering pattern" }); return; }
  // zod here accepts any bounded number (orval cannot emit .int()); counters must be integers.
  if (!Number.isInteger(parsed.data.padding) || !Number.isInteger(parsed.data.startingNumber)) {
    res.status(422).json({ error: "Padding and starting number must be whole numbers" });
    return;
  }
  const pattern = await saveNumberingPattern(req.currentUser!.organizationId, module, parsed.data);
  res.json(UpdateNumberingPatternResponse.parse({
    pattern, configured: true, preview: formatReferenceNumber(pattern, pattern.nextNumber),
  }));
});

router.delete("/platform/numbering/:module", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const module = String(req.params.module) as NumberingModule;
  if (!NUMBERING_MODULES.includes(module)) { res.status(404).json({ error: "Unknown module" }); return; }
  await resetNumberingPattern(req.currentUser!.organizationId, module);
  const map = await getNumberingMap(req.currentUser!.organizationId);
  res.json(ResetNumberingPatternResponse.parse(moduleConfigDto(map, module)));
});

async function fieldSettingsCatalogResponse(organizationId: string) {
  const rows = await db.select().from(moduleFieldSettings).where(and(
    eq(moduleFieldSettings.organizationId, organizationId), isNull(moduleFieldSettings.deletedAt),
  ));
  const accessByKey = new Map(rows.map((row) => [`${row.module}.${row.formKey}.${row.fieldKey}`, row.access]));
  return {
    modules: (Object.entries(FIELD_CATALOG) as Array<[AppKey, typeof FIELD_CATALOG[AppKey]]>).map(([module, forms]) => ({
      module,
      forms: forms.map((form) => ({
        formKey: form.formKey,
        label: form.label,
        fields: form.fields.map((field) => ({
          fieldKey: field.fieldKey,
          label: field.label,
          access: accessByKey.get(`${module}.${form.formKey}.${field.fieldKey}`) ?? "editable",
        })),
      })),
    })),
  };
}

router.get("/platform/field-settings", requireAuth, async (req, res): Promise<void> => {
  const user = req.currentUser!;
  res.json(GetFieldSettingsResponse.parse(await fieldSettingsCatalogResponse(user.organizationId)));
});

router.put("/platform/field-settings", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const parsed = UpdateFieldSettingsBody.safeParse(req.body);
  if (!parsed.success) { res.status(422).json({ error: parsed.error.issues[0]?.message ?? "Invalid field settings" }); return; }
  const user = req.currentUser!;
  const known = catalogKeys();
  const unknown = parsed.data.settings.filter((entry) => !known.has(`${entry.module}.${entry.formKey}.${entry.fieldKey}`));
  if (unknown.length) {
    res.status(422).json({ error: `Unknown field setting(s): ${unknown.map((entry) => `${entry.module}.${entry.formKey}.${entry.fieldKey}`).join(", ")}` });
    return;
  }
  for (const entry of parsed.data.settings) {
    const [existing] = await db.select({ id: moduleFieldSettings.id }).from(moduleFieldSettings).where(and(
      eq(moduleFieldSettings.organizationId, user.organizationId),
      eq(moduleFieldSettings.module, entry.module),
      eq(moduleFieldSettings.formKey, entry.formKey),
      eq(moduleFieldSettings.fieldKey, entry.fieldKey),
      isNull(moduleFieldSettings.deletedAt),
    )).limit(1);
    if (existing) {
      await db.update(moduleFieldSettings).set({ access: entry.access, updatedAt: new Date() }).where(eq(moduleFieldSettings.id, existing.id));
    } else {
      await db.insert(moduleFieldSettings).values({
        organizationId: user.organizationId,
        module: entry.module,
        formKey: entry.formKey,
        fieldKey: entry.fieldKey,
        access: entry.access,
      });
    }
  }
  res.json(UpdateFieldSettingsResponse.parse(await fieldSettingsCatalogResponse(user.organizationId)));
});

export { appDefinitions, userHasAppAccess };
export default router;