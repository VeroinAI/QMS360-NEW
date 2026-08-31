import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import {
  auditFindings,
  auditPlans,
  auditSchedules,
  audits,
  businessUnits,
  categorisationRiskMaster,
  customerSatisfactionEntries,
  db,
  disciplines,
  documentGovernanceLogEntries,
  lessonLearnedForms,
  materialInspectionEntries,
  organizations,
  permissions,
  platformRoles,
  projects,
  qaqcMetricEntries,
  qualityAssessmentBriefs,
  qtbtEntries,
  correctiveActionReports,
  userWorkspaceRoles,
  users,
  workspaceRoles,
} from "@workspace/db";

const permissionKeys = [
  ["create_edit", "Create / Edit", "Create and edit records"],
  ["submit", "Submit", "Submit records for review"],
  ["approve_reject", "Approve / Reject", "Approve or send records back"],
  ["view_own", "View Own", "View records within assigned scope"],
  ["view_all", "View All", "View all records in the application"],
  ["configure_masters", "Configure Masters", "Manage application master data"],
  ["manage_integrations", "Manage Integrations", "Configure integrations"],
  ["manage_ai_settings", "Manage AI Settings", "Configure AI governance"],
  ["export", "Export", "Export reports and data"],
  ["delegate", "Delegate", "Manage time-boxed delegations"],
] as const;

async function seed() {
  const [organization] = await db.insert(organizations).values({
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
  }).onConflictDoNothing().returning();
  const org = organization ?? (await db.select().from(organizations).where(eq(organizations.code, "AGH")).limit(1))[0];
  if (!org) throw new Error("Unable to seed organization");

  const permissionMap = new Map<string, string>();
  for (const [key, label, description] of permissionKeys) {
    const [existing] = await db.select().from(permissions).where(eq(permissions.key, key)).limit(1);
    const permission = existing ?? (await db.insert(permissions).values({ key, label, description, category: key === "view_own" || key === "view_all" ? "visibility" : "workflow" }).returning())[0];
    if (permission) permissionMap.set(key, permission.id);
  }

  const platformRoleNames = ["Super Admin", "Org Admin", "Executive Viewer", "BU / Project Head", "Quality Manager", "Employee", "External / Guest Auditor"];
  const platformRoleMap = new Map<string, string>();
  for (const name of platformRoleNames) {
    const [existing] = await db.select().from(platformRoles).where(and(eq(platformRoles.organizationId, org.id), eq(platformRoles.name, name))).limit(1);
    const role = existing ?? (await db.insert(platformRoles).values({ organizationId: org.id, name, description: "System platform role", isSystem: true }).returning())[0];
    if (role) platformRoleMap.set(name, role.id);
  }

  const workspaceRoleInputs = [
    ["qaqc", "QAQC Representative", "Capture and submit QA/QC records"],
    ["qaqc", "Document Controller", "Own document governance entries"],
    ["qaqc", "Approver / Reviewer", "Review QA/QC submissions"],
    ["lessons", "Form Creator", "Capture and submit lesson learned forms"],
    ["lessons", "Form Approver", "Review lesson learned forms"],
    ["audit", "Audit Program Manager", "Manage the annual audit program"],
    ["audit", "Audit Team Lead / Auditor", "Execute audits and verify findings"],
    ["audit", "Process / Product Owner", "Own corrective actions"],
  ] as const;
  const workspaceRoleMap = new Map<string, string>();
  for (const [appKey, name, description] of workspaceRoleInputs) {
    const [existing] = await db.select().from(workspaceRoles).where(and(eq(workspaceRoles.organizationId, org.id), eq(workspaceRoles.appKey, appKey), eq(workspaceRoles.name, name))).limit(1);
    const role = existing ?? (await db.insert(workspaceRoles).values({ organizationId: org.id, appKey, name, description, isSystem: true }).returning())[0];
    if (role) workspaceRoleMap.set(name, role.id);
  }

  const [buDelivery] = await db.insert(businessUnits).values({ organizationId: org.id, code: "DEL", name: "Delivery & Projects", headName: "Mariam Al-Salem" }).onConflictDoNothing().returning();
  const [buCorporate] = await db.insert(businessUnits).values({ organizationId: org.id, code: "CORP", name: "Corporate Services", headName: "Omar Al-Harbi" }).onConflictDoNothing().returning();
  const delivery = buDelivery ?? (await db.select().from(businessUnits).where(and(eq(businessUnits.organizationId, org.id), eq(businessUnits.code, "DEL"))).limit(1))[0];
  const corporate = buCorporate ?? (await db.select().from(businessUnits).where(and(eq(businessUnits.organizationId, org.id), eq(businessUnits.code, "CORP"))).limit(1))[0];
  if (!delivery || !corporate) throw new Error("Unable to seed business units");

  const [alphaInsert] = await db.insert(projects).values({ organizationId: org.id, businessUnitId: delivery.id, externalId: "AGH-P-001", source: "local", code: "AGH-ALPHA", name: "Alpha District Development", location: "Riyadh", status: "active" }).onConflictDoNothing().returning();
  const [betaInsert] = await db.insert(projects).values({ organizationId: org.id, businessUnitId: corporate.id, externalId: "AGH-P-002", source: "local", code: "AGH-BETA", name: "Beta Operations Campus", location: "Jeddah", status: "active" }).onConflictDoNothing().returning();
  const alpha = alphaInsert ?? (await db.select().from(projects).where(and(eq(projects.organizationId, org.id), eq(projects.code, "AGH-ALPHA"))).limit(1))[0];
  const beta = betaInsert ?? (await db.select().from(projects).where(and(eq(projects.organizationId, org.id), eq(projects.code, "AGH-BETA"))).limit(1))[0];
  if (!alpha || !beta) throw new Error("Unable to seed projects");

  const [civil] = await db.insert(disciplines).values({ organizationId: org.id, code: "CIV", name: "Civil & Structural" }).onConflictDoNothing().returning();
  const [mep] = await db.insert(disciplines).values({ organizationId: org.id, code: "MEP", name: "MEP Services" }).onConflictDoNothing().returning();
  const disciplineCivil = civil ?? (await db.select().from(disciplines).where(and(eq(disciplines.organizationId, org.id), eq(disciplines.code, "CIV"))).limit(1))[0];
  const disciplineMep = mep ?? (await db.select().from(disciplines).where(and(eq(disciplines.organizationId, org.id), eq(disciplines.code, "MEP"))).limit(1))[0];
  if (!disciplineCivil || !disciplineMep) throw new Error("Unable to seed disciplines");

  const passwordHash = await bcrypt.hash("Demo1234!", 12);
  const userInputs = [
    { email: "noura.alharbi@algihaz.com", username: "noura.alharbi", fullName: "Noura Alharbi", platformRole: "Super Admin", projectId: alpha.id },
    { email: "admin@algihaz.demo", username: "ag-admin", fullName: "Noura Al-Qahtani", platformRole: "Super Admin", projectId: alpha.id },
    { email: "quality@algihaz.demo", username: "quality-lead", fullName: "Fahad Al-Mutairi", platformRole: "Quality Manager", projectId: alpha.id },
    { email: "audit@algihaz.demo", username: "audit-lead", fullName: "Sara Al-Dosari", platformRole: "Employee", projectId: beta.id },
  ];
  const userMap = new Map<string, string>();
  for (const input of userInputs) {
    const [existing] = await db.select().from(users).where(and(eq(users.organizationId, org.id), eq(users.email, input.email))).limit(1);
    const user = existing ?? (await db.insert(users).values({
      organizationId: org.id,
      projectId: input.projectId,
      platformRoleId: platformRoleMap.get(input.platformRole),
      email: input.email,
      username: input.username,
      fullName: input.fullName,
      passwordHash,
      authSource: "local",
    }).returning())[0];
    if (user) userMap.set(input.username, user.id);
  }
  const adminId = userMap.get("ag-admin");
  const demoId = userMap.get("noura.alharbi");
  const qualityId = userMap.get("quality-lead");
  const auditUserId = userMap.get("audit-lead");
  if (!adminId || !demoId || !qualityId || !auditUserId) throw new Error("Unable to seed users");

  const assignments = [
    [demoId, "QAQC Representative"], [demoId, "Approver / Reviewer"], [demoId, "Form Creator"], [demoId, "Form Approver"], [demoId, "Audit Program Manager"], [demoId, "Audit Team Lead / Auditor"],
    [adminId, "QAQC Representative"], [adminId, "Approver / Reviewer"], [adminId, "Form Creator"], [adminId, "Form Approver"], [adminId, "Audit Program Manager"], [adminId, "Audit Team Lead / Auditor"],
    [qualityId, "QAQC Representative"], [qualityId, "Document Controller"], [qualityId, "Approver / Reviewer"],
    [auditUserId, "Audit Team Lead / Auditor"], [auditUserId, "Process / Product Owner"],
  ] as const;
  for (const [userId, roleName] of assignments) {
    const roleId = workspaceRoleMap.get(roleName);
    if (!roleId) continue;
    const [existing] = await db.select().from(userWorkspaceRoles).where(and(eq(userWorkspaceRoles.userId, userId), eq(userWorkspaceRoles.workspaceRoleId, roleId))).limit(1);
    if (!existing) await db.insert(userWorkspaceRoles).values({ userId, workspaceRoleId: roleId, projectIds: [alpha.id, beta.id] });
  }

  const [metric] = await db.insert(qaqcMetricEntries).values({
    organizationId: org.id, projectId: alpha.id, reportingPeriod: "2026-08-01", category: "External NCR",
    issuedCount: 12, closedCount: 9, ageing0To15: 2, ageing15To45: 1, ageingOver45: 0,
  }).onConflictDoNothing().returning();
  if (!metric) {
    const [existing] = await db.select().from(qaqcMetricEntries).where(and(eq(qaqcMetricEntries.projectId, alpha.id), eq(qaqcMetricEntries.reportingPeriod, "2026-08-01"), eq(qaqcMetricEntries.category, "External NCR"))).limit(1);
  }
  await db.insert(materialInspectionEntries).values({ organizationId: org.id, projectId: alpha.id, reportingPeriod: "2026-08-01", mirnTotal: 38, approvedCount: 31, onHoldCount: 4, rejectedCount: 2, hazardousCount: 0, handleWithCareCount: 1, osdCount: 3 }).onConflictDoNothing();
  await db.insert(qtbtEntries).values({ organizationId: org.id, projectId: alpha.id, reportingPeriod: "2026-08-01", talkCount: 8, attendanceCount: 146, durationMinutes: 420 }).onConflictDoNothing();
  await db.insert(customerSatisfactionEntries).values({ organizationId: org.id, projectId: alpha.id, reportingPeriod: "2026-08-01", dimensions: { service: 4, responsiveness: 5, quality: 4 }, outcomes: { recommend: "Yes" }, feedback: "Strong collaboration during the August delivery cycle." }).onConflictDoNothing();
  await db.insert(documentGovernanceLogEntries).values({ organizationId: org.id, projectId: alpha.id, reportingPeriod: "2026-08-01", disciplineId: disciplineCivil.id, entity: "Submittals", statusValue: "Approved", count: 64, averageReviewDays: "3.2", pendingDays: 0 }).onConflictDoNothing();
  await db.insert(qualityAssessmentBriefs).values({ organizationId: org.id, projectId: alpha.id, reportingPeriod: "2026-08-01", narrative: "August quality performance is trending positively with strong closure discipline.", workflowState: "approved", submittedById: qualityId, approvedById: adminId }).onConflictDoNothing();

  const [lesson] = await db.insert(lessonLearnedForms).values({
    organizationId: org.id, projectId: alpha.id, disciplineId: disciplineMep.id, referenceNumber: "LL-2026-0001",
    title: "Late drawing approval drove formwork rework", categorisation: "Design coordination", issueCategory: "Moderate", impact: "Negative",
    description: "A late drawing approval created avoidable formwork rework in the east wing.",
    rootCause: "Approval dependencies were not surfaced early enough in the lookahead plan.",
    correction: "Re-sequenced the affected pour and issued a coordinated drawing pack.",
    correctiveAction: "Add a drawing-approval dependency review to the weekly coordination meeting.",
    isRepeated: false, creatorId: qualityId, workflowState: "submitted",
  }).onConflictDoNothing().returning();
  if (!lesson) {
    const [existing] = await db.select().from(lessonLearnedForms).where(eq(lessonLearnedForms.referenceNumber, "LL-2026-0001")).limit(1);
  }

  const [schedule] = await db.insert(auditSchedules).values({ organizationId: org.id, projectId: beta.id, year: 2026, title: "2026 Internal Audit Programme", workflowState: "approved", ownerId: adminId }).onConflictDoNothing().returning();
  const auditSchedule = schedule ?? (await db.select().from(auditSchedules).where(and(eq(auditSchedules.organizationId, org.id), eq(auditSchedules.year, 2026))).limit(1))[0];
  if (!auditSchedule) throw new Error("Unable to seed audit schedule");
  const [plan] = await db.insert(auditPlans).values({ organizationId: org.id, auditScheduleId: auditSchedule.id, projectId: beta.id, scope: "Project controls and procurement", criteria: "ISO 9001:2015 clauses 8 and 9", auditDate: "2026-08-21", location: "Beta Operations Campus", teamMemberIds: [adminId, auditUserId], workflowState: "ready" }).onConflictDoNothing().returning();
  const auditPlan = plan ?? (await db.select().from(auditPlans).where(eq(auditPlans.auditScheduleId, auditSchedule.id)).limit(1))[0];
  if (!auditPlan) throw new Error("Unable to seed audit plan");
  const [audit] = await db.insert(audits).values({ organizationId: org.id, auditPlanId: auditPlan.id, projectId: beta.id, referenceNumber: "AUD-2026-0004", openingMinutes: "Opening meeting completed with the project team.", workflowState: "in_execution" }).onConflictDoNothing().returning();
  const auditRecord = audit ?? (await db.select().from(audits).where(eq(audits.referenceNumber, "AUD-2026-0004")).limit(1))[0];
  if (!auditRecord) throw new Error("Unable to seed audit");
  const [finding] = await db.insert(auditFindings).values({ organizationId: org.id, auditId: auditRecord.id, responsibleDepartment: "Procurement", classification: "Observation", priority: "P4", riskLevel: "Medium", description: "Supplier evaluation evidence should be retained with the purchase request." }).onConflictDoNothing().returning();
  if (finding) await db.insert(correctiveActionReports).values({ organizationId: org.id, auditFindingId: finding.id, responsibleDepartment: "Procurement", ownerId: auditUserId, rootCause: "Evidence storage ownership was not explicit.", correctiveAction: "Add evidence retention to the procurement checklist.", workflowState: "open", dueDate: "2026-09-15" }).onConflictDoNothing();

  process.stdout.write("QMS360 demo foundation seeded. Demo password: Demo1234!\n");
}

seed().then(() => process.exit(0)).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});