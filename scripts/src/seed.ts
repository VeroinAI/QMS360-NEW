import bcrypt from "bcryptjs";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import {
  applicationAccess,
  organizationSettings,
  auditFindings,
  auditPermissions,
  auditPlans,
  auditPlatformRoles,
  auditSchedules,
  auditUserWorkspaceRoles,
  auditWorkspaceRoles,
  audits,
  businessUnits,
  categorisationRiskMaster,
  customerSatisfactionEntries,
  db,
  disciplines,
  distributionLists,
  documentGovernanceLogEntries,
  lessonLearnedForms,
  lessonsCategorisationRiskMaster,
  lessonsDisciplines,
  lessonsDistributionLists,
  lessonsPermissions,
  lessonsPlatformRoles,
  lessonsUserWorkspaceRoles,
  lessonsWorkspaceRolePermissions,
  lessonsWorkspaceRoles,
  materialInspectionEntries,
  masterDataGroups,
  masterDataValues,
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

  const masterGroups = [
    ["disciplines", "Discipline Master", "global", ["Electrical", "Civil", "Mechanical", "Precast", "Architectural", "Testing & Commissioning", "Plumbing", "RTR & Piping", "Instrumentation", "Communications", "Storage & Handling", "Material Receiving"]],
    ["audit_types", "Audit Type Master", "audit", ["Quality Internal Process Audit", "Quality Internal Product Audit"]],
    ["audit_categories", "Audit Category Master", "audit", ["Business Unit", "Regional Office", "Project"]],
    ["risk_levels", "Risk Level Master", "audit", ["Low", "Medium", "High"]],
    ["nc_classifications", "NC Classification", "audit", ["Conformity", "Observation", "Minor NC", "Major NC"]],
    ["lesson_issue_categories", "Lesson Issue Categories", "lessons", ["Minor", "Moderate", "Major"]],
    ["lesson_categorisations", "Lessons Learned Categorisation", "lessons", ["Design coordination", "Planning", "Execution", "Quality", "Safety", "Procurement", "Stakeholder coordination"]],
    ["lesson_impacts", "Lesson Impacts", "lessons", ["Positive", "Negative"]],
    ["document_types", "Document Types", "qaqc", ["Submittal", "Drawing", "Correspondence"]],
    ["document_statuses", "Document Statuses", "qaqc", ["Approved", "Resubmit", "Rejected", "Under Review"]],
    ["pending_with", "Pending With", "qaqc", ["Client", "Algihaz", "Supplier"]],
    ["finding_priorities", "Finding Priorities", "audit", ["P1", "P2", "P3", "P4", "P5", "P6"]],
    ["checklist_results", "Checklist Results", "audit", ["Conformity", "Observation", "Minor NC", "Major NC", "Not Applicable"]],
    ["distribution_events", "Distribution List Events", "global", ["Monthly QAQC Metric Dashboard & Report", "Biweekly Document Governance Report", "Customer Satisfaction Form", "Lesson Learnt Approved Form", "Audit Memo Circulation", "Audit Plan Circulation", "Audit Report Circulation"]],
    ["metric_categories", "QAQC Metric Categories", "qaqc", ["External NCR", "Internal NCR", "RFI", "RMI"]],
  ] as const;
  for (const [groupOrder, [code, name, appScope, values]] of masterGroups.entries()) {
    const [existingGroup] = await db.select().from(masterDataGroups).where(and(
      eq(masterDataGroups.organizationId, org.id),
      eq(masterDataGroups.code, code),
    )).limit(1);
    const group = existingGroup ?? (await db.insert(masterDataGroups).values({
      organizationId: org.id, code, name, appScope, isSystem: true, sortOrder: groupOrder,
    }).returning())[0];
    if (!group) throw new Error(`Unable to seed master data group ${code}`);
    if (!group.isSystem || group.deletedAt) {
      await db.update(masterDataGroups).set({
        name, appScope, isSystem: true, sortOrder: groupOrder, status: "active", deletedAt: null, updatedAt: new Date(),
      }).where(eq(masterDataGroups.id, group.id));
    }
    for (const [valueOrder, value] of values.entries()) {
      const [activeValue] = await db.select().from(masterDataValues).where(and(
        eq(masterDataValues.organizationId, org.id),
        eq(masterDataValues.groupId, group.id),
        eq(masterDataValues.value, value),
        isNull(masterDataValues.deletedAt),
      )).limit(1);
      const [deletedValue] = activeValue ? [] : await db.select().from(masterDataValues).where(and(
        eq(masterDataValues.organizationId, org.id),
        eq(masterDataValues.groupId, group.id),
        eq(masterDataValues.value, value),
        isNotNull(masterDataValues.deletedAt),
      )).limit(1);
      const existingValue = activeValue ?? deletedValue;
      if (existingValue) {
        await db.update(masterDataValues).set({
          label: value, sortOrder: valueOrder, active: true, status: "active", deletedAt: null, updatedAt: new Date(),
        }).where(eq(masterDataValues.id, existingValue.id));
      } else {
        await db.insert(masterDataValues).values({
          organizationId: org.id, groupId: group.id, value, label: value, sortOrder: valueOrder,
        });
      }
    }
  }

  for (const permissionTableValue of [permissions, lessonsPermissions, auditPermissions]) {
    const permissionTable = permissionTableValue as typeof permissions;
    for (const [key, label, description] of permissionKeys) {
      const [existing] = await db.select().from(permissionTable).where(and(eq(permissionTable.organizationId, org.id), eq(permissionTable.key, key))).limit(1);
      if (!existing) {
        await db.insert(permissionTable).values({
          organizationId: org.id,
          key,
          label,
          description,
          category: key === "view_own" || key === "view_all" ? "visibility" : "workflow",
        });
      }
    }
  }

  const platformRoleNames = ["Super Admin", "Org Admin", "Executive Viewer", "BU / Project Head", "Quality Manager", "Employee", "External / Guest Auditor"];
  const platformRoleMap = new Map<string, string>();
  for (const [appIndex, roleTableValue] of [platformRoles, lessonsPlatformRoles, auditPlatformRoles].entries()) {
    const roleTable = roleTableValue as typeof platformRoles;
    for (const name of platformRoleNames) {
      const [existing] = await db.select().from(roleTable).where(and(eq(roleTable.organizationId, org.id), eq(roleTable.name, name))).limit(1);
      const role = existing ?? (await db.insert(roleTable).values({ organizationId: org.id, name, description: "System platform role", isSystem: true }).returning())[0];
      if (appIndex === 0 && role) platformRoleMap.set(name, role.id);
    }
  }

  const workspaceRoleGroups = [
    [workspaceRoles, [
      ["QAQC Representative", "Capture and submit QA/QC records"],
      ["Document Controller", "Own document governance entries"],
      ["Approver / Reviewer", "Review QA/QC submissions"],
    ]],
    [lessonsWorkspaceRoles, [
      ["Form Creator", "Capture and submit lesson learned forms"],
      ["Form Approver", "Review lesson learned forms"],
    ]],
    [auditWorkspaceRoles, [
      ["Audit Program Manager", "Manage the annual audit program"],
      ["Audit Team Lead / Auditor", "Execute audits and verify findings"],
      ["Process / Product Owner", "Own corrective actions"],
    ]],
  ] as const;
  const workspaceRoleMaps = workspaceRoleGroups.map(() => new Map<string, string>());
  for (const [groupIndex, [roleTableValue, inputs]] of workspaceRoleGroups.entries()) {
    const roleTable = roleTableValue as typeof workspaceRoles;
    for (const [name, description] of inputs) {
      const [existing] = await db.select().from(roleTable).where(and(eq(roleTable.organizationId, org.id), eq(roleTable.name, name))).limit(1);
      const role = existing ?? (await db.insert(roleTable).values({ organizationId: org.id, name, description, isSystem: true }).returning())[0];
      if (role) workspaceRoleMaps[groupIndex]!.set(name, role.id);
    }
  }

  const [buDelivery] = await db.insert(businessUnits).values({ organizationId: org.id, code: "DEL", name: "Delivery & Projects", headName: "Mariam Al-Salem" }).onConflictDoNothing().returning();
  const [buCorporate] = await db.insert(businessUnits).values({ organizationId: org.id, code: "CORP", name: "Corporate Services", headName: "Omar Al-Harbi" }).onConflictDoNothing().returning();
  const delivery = buDelivery ?? (await db.select().from(businessUnits).where(and(eq(businessUnits.organizationId, org.id), eq(businessUnits.code, "DEL"))).limit(1))[0];
  const corporate = buCorporate ?? (await db.select().from(businessUnits).where(and(eq(businessUnits.organizationId, org.id), eq(businessUnits.code, "CORP"))).limit(1))[0];
  if (!delivery || !corporate) throw new Error("Unable to seed business units");

  const [settings] = await db.select().from(organizationSettings).where(eq(organizationSettings.organizationId, org.id)).limit(1);
  if (!settings) {
    await db.insert(organizationSettings).values({
      organizationId: org.id,
      branding: org.branding,
      locale: org.locale,
      timezone: org.timezone,
      allowedEmailDomains: ["algihaz.com", "algihaz.demo"],
    });
  }

  const [alphaInsert] = await db.insert(projects).values({ organizationId: org.id, businessUnitId: delivery.id, externalId: "AGH-P-001", source: "local", code: "AGH-ALPHA", name: "Alpha District Development", location: "Riyadh", status: "active" }).onConflictDoNothing().returning();
  const [betaInsert] = await db.insert(projects).values({ organizationId: org.id, businessUnitId: corporate.id, externalId: "AGH-P-002", source: "local", code: "AGH-BETA", name: "Beta Operations Campus", location: "Jeddah", status: "active" }).onConflictDoNothing().returning();
  const alpha = alphaInsert ?? (await db.select().from(projects).where(and(eq(projects.organizationId, org.id), eq(projects.code, "AGH-ALPHA"))).limit(1))[0];
  const beta = betaInsert ?? (await db.select().from(projects).where(and(eq(projects.organizationId, org.id), eq(projects.code, "AGH-BETA"))).limit(1))[0];
  if (!alpha || !beta) throw new Error("Unable to seed projects");

  const disciplineInputs = [
    ["ELEC", "Electrical"], ["CIV", "Civil"], ["MECH", "Mechanical"], ["PREC", "Precast"],
    ["ARCH", "Architectural"], ["TANDC", "Testing & Commissioning"], ["PLUMB", "Plumbing"],
    ["RTR", "RTR & Piping"], ["INST", "Instrumentation"], ["COMM", "Communications"],
    ["STOR", "Storage & Handling"], ["MATR", "Material Receiving"],
  ] as const;
  for (const tableValue of [disciplines, lessonsDisciplines]) {
    const table = tableValue as typeof disciplines;
    for (const [code, name] of disciplineInputs) {
      const [existing] = await db.select().from(table).where(and(
        eq(table.organizationId, org.id), eq(table.code, code),
      )).limit(1);
      if (existing) {
        await db.update(table).set({ name, status: "active", deletedAt: null, updatedAt: new Date() }).where(eq(table.id, existing.id));
      } else {
        await db.insert(table).values({ organizationId: org.id, code, name });
      }
    }
  }
  const distributionEvents = masterGroups.find(([code]) => code === "distribution_events")![3];
  for (const tableValue of [distributionLists, lessonsDistributionLists]) {
    const table = tableValue as typeof distributionLists;
    for (const name of distributionEvents) {
      const [existing] = await db.select().from(table).where(and(
        eq(table.organizationId, org.id), eq(table.name, name),
      )).limit(1);
      if (existing) {
        await db.update(table).set({ status: "active", deletedAt: null, updatedAt: new Date() }).where(eq(table.id, existing.id));
      } else {
        await db.insert(table).values({ organizationId: org.id, name });
      }
    }
  }
  const [civil] = await db.select().from(disciplines).where(and(eq(disciplines.organizationId, org.id), eq(disciplines.code, "CIV"))).limit(1);
  const [mep] = await db.insert(disciplines).values({ organizationId: org.id, code: "MEP", name: "MEP Services" }).onConflictDoNothing().returning();
  const disciplineCivil = civil;
  const disciplineMep = mep ?? (await db.select().from(disciplines).where(and(eq(disciplines.organizationId, org.id), eq(disciplines.code, "MEP"))).limit(1))[0];
  if (!disciplineCivil || !disciplineMep) throw new Error("Unable to seed disciplines");
  const [lessonMepInsert] = await db.insert(lessonsDisciplines).values({ organizationId: org.id, code: "MEP", name: "MEP Services" }).onConflictDoNothing().returning();
  const lessonDisciplineMep = lessonMepInsert ?? (await db.select().from(lessonsDisciplines).where(and(eq(lessonsDisciplines.organizationId, org.id), eq(lessonsDisciplines.code, "MEP"))).limit(1))[0];
  if (!lessonDisciplineMep) throw new Error("Unable to seed Lesson Learned disciplines");
  const [lessonCategory] = await db.select().from(lessonsCategorisationRiskMaster).where(and(
    eq(lessonsCategorisationRiskMaster.organizationId, org.id),
    eq(lessonsCategorisationRiskMaster.category, "Design coordination"),
  )).limit(1);
  if (!lessonCategory) {
    await db.insert(lessonsCategorisationRiskMaster).values({
      organizationId: org.id,
      category: "Design coordination",
      impact: "Negative",
      riskLevel: "Medium",
    });
  }

  const passwordHash = await bcrypt.hash("Demo1234!", 12);
  const userInputs = [
    { email: "noura.alharbi@algihaz.com", username: "noura.alharbi", fullName: "Noura Alharbi", platformRole: "Super Admin", projectId: alpha.id },
    { email: "admin@algihaz.demo", username: "ag-admin", fullName: "Noura Al-Qahtani", platformRole: "Super Admin", projectId: alpha.id },
    { email: "quality@algihaz.demo", username: "quality-lead", fullName: "Fahad Al-Mutairi", platformRole: "Quality Manager", projectId: alpha.id },
    { email: "audit@algihaz.demo", username: "audit-lead", fullName: "Sara Al-Dosari", platformRole: "Employee", projectId: beta.id },
    { email: "creator@algihaz.demo", username: "lesson-creator", fullName: "Layla Haddad", platformRole: "Employee", projectId: alpha.id },
    // Intentionally has no Lessons workspace role: regression cover for platform-admin review bypass.
    { email: "org.admin@algihaz.demo", username: "org-admin", fullName: "Omar Al-Rashid", platformRole: "Org Admin", projectId: alpha.id },
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
  const creatorId = userMap.get("lesson-creator");
  if (!adminId || !demoId || !qualityId || !auditUserId || !creatorId) throw new Error("Unable to seed users");

  for (const [username, userId] of userMap) {
    const [existing] = await db.select().from(applicationAccess).where(and(eq(applicationAccess.organizationId, org.id), eq(applicationAccess.username, username), eq(applicationAccess.projectId, username === "audit-lead" ? beta.id : alpha.id))).limit(1);
    if (!existing) {
      await db.insert(applicationAccess).values({
        organizationId: org.id,
        username,
        projectId: username === "audit-lead" ? beta.id : alpha.id,
        canOpenQaqc: username !== "audit-lead",
        canOpenLessons: username !== "audit-lead",
        canOpenAudit: true,
        isInitialAdminQaqc: userId === adminId,
        isInitialAdminLessons: userId === adminId,
        isInitialAdminAudit: userId === adminId,
      });
    } else if (username === "audit-lead") {
      await db.update(applicationAccess).set({ canOpenQaqc: false, canOpenLessons: false, canOpenAudit: true }).where(eq(applicationAccess.id, existing.id));
    }
  }

  const lessonsRolePermissionGrants = [
    ["Form Creator", [["create_edit", "own"], ["submit", "own"], ["view_own", "own"]]],
    ["Form Approver", [["approve_reject", "own"], ["view_all", "full"]]],
  ] as const;
  for (const [roleName, grants] of lessonsRolePermissionGrants) {
    const roleId = workspaceRoleMaps[1]!.get(roleName);
    if (!roleId) continue;
    for (const [key, grant] of grants) {
      const [permission] = await db.select().from(lessonsPermissions).where(and(
        eq(lessonsPermissions.organizationId, org.id),
        eq(lessonsPermissions.key, key),
      )).limit(1);
      if (!permission) continue;
      const [existingGrant] = await db.select().from(lessonsWorkspaceRolePermissions).where(and(
        eq(lessonsWorkspaceRolePermissions.workspaceRoleId, roleId),
        eq(lessonsWorkspaceRolePermissions.permissionId, permission.id),
        isNull(lessonsWorkspaceRolePermissions.deletedAt),
      )).limit(1);
      if (existingGrant) {
        await db.update(lessonsWorkspaceRolePermissions).set({ grant, updatedAt: new Date() }).where(eq(lessonsWorkspaceRolePermissions.id, existingGrant.id));
      } else {
        await db.insert(lessonsWorkspaceRolePermissions).values({ organizationId: org.id, workspaceRoleId: roleId, permissionId: permission.id, grant });
      }
    }
  }

  const assignmentGroups = [
    [userWorkspaceRoles, workspaceRoleMaps[0], [
      [demoId, "QAQC Representative"], [demoId, "Approver / Reviewer"],
      [adminId, "QAQC Representative"], [adminId, "Approver / Reviewer"],
      [qualityId, "QAQC Representative"], [qualityId, "Document Controller"], [qualityId, "Approver / Reviewer"],
    ]],
    [lessonsUserWorkspaceRoles, workspaceRoleMaps[1], [
      [demoId, "Form Creator"], [demoId, "Form Approver"],
      [adminId, "Form Creator"], [adminId, "Form Approver"],
      [qualityId, "Form Approver"],
      [creatorId, "Form Creator"],
    ]],
    [auditUserWorkspaceRoles, workspaceRoleMaps[2], [
      [demoId, "Audit Program Manager"], [demoId, "Audit Team Lead / Auditor"],
      [adminId, "Audit Program Manager"], [adminId, "Audit Team Lead / Auditor"],
      [auditUserId, "Audit Team Lead / Auditor"], [auditUserId, "Process / Product Owner"],
    ]],
  ] as const;
  for (const [assignmentTableValue, roleMap, assignments] of assignmentGroups) {
    const assignmentTable = assignmentTableValue as typeof userWorkspaceRoles;
    for (const [userId, roleName] of assignments) {
      const roleId = roleMap.get(roleName);
      if (!roleId) continue;
      const [existing] = await db.select().from(assignmentTable).where(and(eq(assignmentTable.userId, userId), eq(assignmentTable.workspaceRoleId, roleId))).limit(1);
      if (!existing) await db.insert(assignmentTable).values({ organizationId: org.id, userId, workspaceRoleId: roleId, projectIds: [alpha.id, beta.id] });
    }
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
    organizationId: org.id, projectId: alpha.id, disciplineId: lessonDisciplineMep.id, referenceNumber: "LL-2026-0001",
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
