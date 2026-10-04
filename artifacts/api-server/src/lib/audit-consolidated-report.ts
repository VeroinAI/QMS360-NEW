import { auditReportDetailGroups, type AuditReportDetailsData } from "@workspace/field-controls";

type Row = Record<string, any>;
export type ReportSectionData = {
  key: string; title: string; fields: Array<{ label: string; value: string }>;
  tables: Array<{ title: string; columns: string[]; rows: string[][] }>;
  notes: string[]; photos: Array<{ id: string; fileName: string; reference: string; description: string }>;
};
const missing = "Not recorded";
export const auditIsComplete = (state: string) => ["complete", "completed", "closed"].includes(state.toLowerCase());
export function buildConsolidatedAuditReport(input: {
  audit: Row; plan?: Row | null; schedule?: Row | null; project?: Row | null;
  legacyFindings: Row[]; cars: Row[]; evidence: Row[]; names: Map<string, string>;
  roleNames: Map<string, string>; timeZone?: string;
}): ReportSectionData[] {
  const { audit, plan, project, names, roleNames, evidence, legacyFindings, cars } = input;
  const details: AuditReportDetailsData = audit.reportDetails ?? { values: {}, rows: {} };
  const value = (v: unknown) => v === null || v === undefined || v === "" ? missing : String(v);
  const recorded = (key: string, fallback?: unknown) => value(details.values[key]?.trim() || fallback);
  const date = (v: unknown) => {
    if (!v) return missing;
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    const d = new Date(v as string);
    return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat("en-GB", {
      timeZone: input.timeZone ?? "Asia/Riyadh", dateStyle: "medium",
    }).format(d) : missing;
  };
  const name = (id?: string) => value(id ? names.get(id) ?? (/^[0-9a-f-]{36}$/i.test(id) ? undefined : id) : undefined);
  const namesOf = (ids: string[] = []) => ids.length ? ids.map(name).join(", ") : missing;
  const projectField = (...keys: string[]) => {
    const fields = project?.customFields ?? {};
    for (const key of keys) {
      if (project?.[key]) return project[key];
      const found = Object.entries(fields).find(([field]) => field.toLowerCase().replace(/[^a-z0-9]/g, "") === key.toLowerCase().replace(/[^a-z0-9]/g, ""));
      if (found?.[1]) return found[1];
    }
    return undefined;
  };
  const sections: ReportSectionData[] = [];
  const section = (key: string, title: string) => {
    const s: ReportSectionData = { key, title, fields: [], tables: [], notes: [], photos: [] };
    sections.push(s); return s;
  };
  const fields = (s: ReportSectionData, entries: Array<[string, unknown]>) => {
    s.fields.push(...entries.map(([label, v]) => ({ label, value: value(v) })));
  };
  const collection = (s: ReportSectionData, key: string) => {
    const def = auditReportDetailGroups.flatMap(g => g.collections ?? []).find(c => c.key === key)!;
    s.tables.push({ title: def.label, columns: def.columns.map(c => c.label),
      rows: (details.rows[key] ?? []).map(row => def.columns.map(c => value(row[c.key]))) });
  };
  const cover = section("cover", "Quality Internal Audit Report");
  fields(cover, [
    ["Project / process / site", project?.name ?? audit.title], ["Audit title", audit.title],
    ["Scope", recorded("inScope", plan?.qaqcScope ?? plan?.scope)],
    ["Audit reference", input.schedule?.qaqcReference || plan?.qaqcReference || audit.referenceNumber || audit.title],
    ["Audit dates", `${date(plan?.startDateTime ?? audit.startedAt)} – ${date(plan?.endDateTime ?? audit.closedAt)}`],
    ["Contract / project number", recorded("contractNumber", projectField("contractNumber", "projectNumber", "code"))],
    ["Report revision", recorded("reportRevision")],
  ]);
  const control = section("document-control", "Document control and approval");
  fields(control, [
    ["Form title", recorded("formTitle", "Quality Internal Audit Report")], ["Form number", recorded("formNumber")],
    ["Form revision", recorded("formRevision")], ["Effective date", recorded("effectiveDate")],
    ["Process owner", recorded("processOwner")], ["Applies to", recorded("appliesTo")],
  ]);
  collection(control, "documentApprovals"); collection(control, "revisionHistory");
  control.notes.push("Signature details are entered by the report author. Blank sign-off fields are not evidence of approval.");
  const overview = section("audit-overview", "Audit details and project profile");
  fields(overview, [
    ["Audit title", audit.title], ["Audit reference", input.schedule?.qaqcReference || plan?.qaqcReference || audit.referenceNumber || audit.title],
    ["Audit type", plan?.auditTypes?.join(", ")], ["Audit dates", cover.fields.find(f => f.label === "Audit dates")?.value],
    ["Location / department", recorded("location", plan?.location ?? input.schedule?.department)],
    ["Lead auditor", name(plan?.leadAuditorId)], ["Audit team", namesOf(plan?.teamMemberIds)],
    ["Auditee representatives", audit.openingMeeting?.attendees?.length ? namesOf(audit.openingMeeting.attendees)
      : plan?.auditeeRoleIds?.map((id: string) => value(roleNames.get(id))).join(", ")],
    ["Client", recorded("client", projectField("client", "clientName"))],
    ["Contractor", recorded("contractor", projectField("contractor", "contractorName"))],
    ["Contract / project number", recorded("contractNumber", projectField("contractNumber", "projectNumber", "code"))],
    ["Contract signed", recorded("contractSigned", projectField("contractSigned", "contractSignedDate"))],
    ["Contract period", recorded("contractPeriod", projectField("contractPeriod"))],
    ["TCC", recorded("tcc", projectField("tcc"))], ["PAC", recorded("pac", projectField("pac"))],
    ["FAC", recorded("fac", projectField("fac"))],
  ]);
  const scope = section("scope", "Objective, scope, criteria and method");
  fields(scope, [
    ["Objective", recorded("objective", plan?.objectives)], ["In scope", recorded("inScope", plan?.qaqcScope ?? plan?.scope)],
    ["Not in scope / not audited, and why", recorded("notInScope")], ["Period and sample covered", recorded("samplePeriod")],
    ["Project phases covered", recorded("projectPhases")], ["Audit criteria", recorded("criteria", plan?.criteria?.join("\n") || input.schedule?.qaqcClauses)],
    ["Method", recorded("method")], ["Sampling basis", recorded("samplingBasis")],
  ]);
  const programme = section("programme", "Audit programme and participation");
  programme.tables.push({ title: "Audit programme", columns: ["Date / time", "Activity", "Remarks", "Auditee"],
    rows: (plan?.activities ?? []).map((a: Row) => [value(plan?.activityDateTime), value(a.section), value(a.remarks), name(a.auditeeId)]) });
  fields(programme, [
    ["Opening meeting", date(audit.openingMeeting?.heldAt)], ["Opening minutes", audit.openingMeeting?.minutes],
    ["Audit team", namesOf(plan?.teamMemberIds)], ["Auditees present", namesOf(audit.openingMeeting?.attendees)],
    ["Not represented", recorded("notRepresented")], ["Closing meeting", date(audit.closingMeeting?.heldAt)],
    ["Closing minutes", audit.closingMeeting?.minutes],
  ]);
  const checklist: Row[] = audit.checklist ?? [];
  const linkedLegacyIds = new Set(checklist.map(row => row.findingId).filter(Boolean));
  const source: Row[] = [
    ...checklist.filter(row => ["Major NC", "Moderate NC", "Minor NC", "OFI"].includes(row.auditFinding))
      .map(row => ({ ...row, grade: row.auditFinding === "OFI" ? "OFI" : row.auditFinding.replace(" NC", ""), legacy: false })),
    ...legacyFindings.filter(row => !linkedLegacyIds.has(row.id))
      .filter(row => !/^(conform|positive|not applicable)/i.test(row.classification ?? ""))
      .map(row => ({ ...row, grade: /ofi|opportunit|^observation$/i.test(row.classification ?? "") ? "OFI"
        : /major/i.test(row.classification ?? "") ? "Major" : /moderate/i.test(row.classification ?? "") ? "Moderate"
        : /minor/i.test(row.classification ?? "") ? "Minor" : "Unclassified NC", legacy: true })),
  ];
  const areaNumbers = new Map<string, number>(), areaCounts = new Map<string, number>();
  const findings: Row[] = source.map(row => {
    const area = value(row.auditArea ?? row.responsibleDepartments?.join(", "));
    if (!areaNumbers.has(area)) areaNumbers.set(area, areaNumbers.size + 1);
    const number = (areaCounts.get(area) ?? 0) + 1; areaCounts.set(area, number);
    return { ...row, area, reference: row.clientReference || `B.${areaNumbers.get(area)}.${number}` };
  });
  const counts = (grade: string) => findings.filter(row => row.grade === grade).length;
  const summary = section("executive-summary", "Audit results at a glance");
  fields(summary, [
    ["Non-conformities", findings.filter(row => row.grade !== "OFI").length], ["Opportunities for improvement", counts("OFI")],
    ["Major", counts("Major")], ["Moderate", counts("Moderate")], ["Minor", counts("Minor")],
    ["Unclassified NC", counts("Unclassified NC")], ["Overall rating", recorded("overallRating")],
    ["Overall conclusion", recorded("overallConclusion")], ["Key messages", recorded("keyMessages")],
  ]);
  const area = section("findings-summary", "Findings summary by audit area");
  const areaRows = [...areaNumbers.keys()].map(a => {
    const items = findings.filter(f => f.area === a);
    return [a, ...["Major", "Moderate", "Minor", "OFI", "Unclassified NC"].map(grade => String(items.filter(f => f.grade === grade).length)), String(items.length)];
  });
  area.tables.push({ title: "Findings by audit area", columns: ["Audit area", "Major", "Moderate", "Minor", "OFI", "Unclassified NC", "Total"],
    rows: [...areaRows, ["Total", ...["Major", "Moderate", "Minor", "OFI", "Unclassified NC"].map(grade => String(counts(grade))), String(findings.length)]] });
  collection(area, "recurringThemes");
  const progress = section("project-progress", "Overall project progress");
  const phaseRows = details.rows.progress ?? [];
  const percent = (v: string | undefined) => v?.trim() ? `${v}%` : missing;
  const validOverall = phaseRows.length > 0 && phaseRows.every(r => ["weight", "plan", "actual"].every(k => r[k]?.trim() && Number.isFinite(Number(r[k]))))
    && Math.abs(phaseRows.reduce((n, r) => n + Number(r.weight), 0) - 100) < 0.01;
  const weighted = (key: string) => phaseRows.reduce((n, r) => n + Number(r.weight) * Number(r[key]) / 100, 0);
  progress.tables.push({ title: "Project progress", columns: ["Phase", "Weight", "Plan", "Actual", "Variance (pp)", "Prior period"],
    rows: [...phaseRows.map(r => [value(r.phase), percent(r.weight), percent(r.plan), percent(r.actual),
      r.plan?.trim() && r.actual?.trim() ? (Number(r.actual) - Number(r.plan)).toFixed(2) : missing, percent(r.priorPeriod)]),
    ...(validOverall ? [["Overall", "100%", `${weighted("plan").toFixed(2)}%`, `${weighted("actual").toFixed(2)}%`, (weighted("actual") - weighted("plan")).toFixed(2), missing]] : [])] });
  fields(progress, [["Data as at", recorded("progressDataAsAt")], ["Source", recorded("progressSource")], ["Auditor comment", recorded("progressComment")]]);
  if (!phaseRows.length) progress.notes.push("Not applicable / no project progress data recorded.");
  const documents = audit.additionalDocuments ?? {};
  const designProcurement = section("design-procurement", "Design and procurement status");
  const designRows: Row[] = documents.designStatus ?? [], procurementRows: Row[] = documents.procurementStatus ?? [];
  const designTotal = designRows.reduce((n, row) => n + Number(row.value ?? 0), 0);
  designProcurement.tables.push({ title: "Design submittals (DTS)", columns: ["Status", "Count", "%"],
    rows: [...designRows.map(row => [value(row.label), value(row.value), row.value == null || designRows.some(r => r.value == null) ? missing : designTotal ? `${(Number(row.value) * 100 / designTotal).toFixed(2)}%` : "0%"]),
      ...(designRows.length ? [["Total submittals", String(designTotal), designTotal ? "100%" : "0%"]] : [])] });
  designProcurement.tables.push({ title: "Procurement", columns: ["Item", "Count"], rows: procurementRows.map(row => [value(row.label), value(row.value)]) });
  fields(designProcurement, [["Design comment", documents.designRemarks], ["Procurement comment", documents.procurementRemarks]]);
  const conforming = section("conforming", "Areas verified as conforming and good practices");
  conforming.tables.push({ title: "Conforming areas", columns: ["Area / process", "What was verified", "Record / evidence reference"],
    rows: checklist.filter(row => /^(pass|conform|satisfactory|compliant)$/i.test(row.result ?? "") && !row.auditFinding)
      .map(row => [value(row.auditArea), value(row.description ?? row.question), (row.evidenceIds ?? []).map((id: string) => value(evidence.find(e => e.id === id)?.fileName)).join(", ") || missing]) });
  conforming.tables.push({ title: "Good practices and positive observations", columns: ["Area / process", "What was verified and found conforming", "Record / evidence reference", "Reference number"],
    rows: (documents.goodPractices ?? []).map((row: Row) => [value(row.areaProcess), value(row.verifiedConforming), value(row.evidenceReference), value(row.referenceNumber)]) });
  const register = (key: string, title: string, items: Row[]) => {
    const s = section(key, title);
    s.tables.push({ title, columns: ["Ref", "Audit area", "Finding", "Objective evidence", "Requirement", "Grade"],
      rows: items.map(row => [row.reference, row.area, value(row.description ?? row.question ?? row.title),
        (row.evidenceIds ?? []).map((id: string) => value(evidence.find(e => e.id === id)?.fileName)).join(", ") || value(row.notes),
        value(row.clause), row.grade]) });
  };
  register("non-conformities", "Non-conformity register", findings.filter(row => row.grade !== "OFI"));
  register("ofi", "Opportunities for improvement", findings.filter(row => row.grade === "OFI"));
  const photographs = section("photographs", "Photographic evidence");
  for (const file of evidence.filter(file => /^image\/(png|jpeg|webp|gif)$/i.test(file.mimeType) && file.id !== documents.organizationChartId)) {
    const row = findings.find(f => f.evidenceIds?.includes(file.id));
    const caption = details.rows.photographs?.find(c => c.fileName?.trim() === file.fileName && (!c.reference?.trim() || c.reference.trim() === row?.reference))
      ?? details.rows.photographs?.find(c => c.fileName?.trim() === file.fileName);
    photographs.photos.push({ id: file.id, fileName: file.fileName, reference: row?.reference || caption?.reference || missing,
      description: `Grade: ${value(row?.grade || caption?.grade)}\nDate captured: ${date(caption?.date)}\nDate uploaded: ${date(file.createdAt)}\nLocation: ${value(caption?.location || details.values.location || plan?.location || row?.area)}\nDescription: ${value(caption?.description || row?.description || row?.question || file.fileName)}\nRequirement: ${value(row?.clause || caption?.requirement)}` });
  }
  const grading = section("grading", "Finding grades and response requirements");
  grading.tables.push({ title: "Client template grading guidance", columns: ["Grade", "Definition", "Response requirement"],
    rows: [
      ["Major", "Failure of a required control, or a condition that could compromise the integrity, safety or performance of the works or system.", "Immediate containment. CAPA plan within 7 days; closure within 30 days."],
      ["Moderate", "Significant departure from a specified requirement that could affect quality if left uncorrected.", "CAPA plan within 14 days; closure within 45 days."],
      ["Minor", "Isolated lapse or documentation gap with low immediate impact.", "CAPA plan within 14 days; closure within 60 days."],
      ["OFI", "Improvement suggestion; not a breach of a requirement.", "Auditee decides and records its response; reviewed at the next audit."],
    ] });
  grading.notes.push("Definitions and response windows are proposed for approval in the supplied client standard. This report does not change existing CAR due dates.",
    "Response sequence: root-cause analysis and CAPA plan; audit team acceptance; implementation with evidence; effectiveness verification; closure in tracker.");
  const tracker = section("corrective-actions", "Corrective action tracker");
  tracker.tables.push({ title: "Corrective actions", columns: ["Ref", "Grade", "Root cause", "Correction and corrective action", "Owner", "Due date", "Status", "Verified by / date"],
    rows: cars.map(car => { const f = findings.find(f => f.id === car.findingId);
      return [f?.reference ?? missing, f?.grade ?? missing, value(car.rootCause),
        [car.correction, car.correctiveAction].filter(Boolean).join("\n") || missing, name(car.ownerId), date(car.dueDate),
        value(car.status), car.effectivenessVerified ? `Effectiveness verified; ${date(car.closedAt)}; verifier ${missing}` : missing]; }) });
  const actions = section("priority-actions", "Recommended priority actions");
  for (const key of ["containRisk", "correctClose", "preventRecurrence"]) collection(actions, key);
  const conclusion = section("conclusion", "Conclusion and sign-off");
  fields(conclusion, [
    ["Headline conclusion", recorded("headlineConclusion")], ["Objectives achieved", recorded("objectivesAchieved")],
    ["System effectiveness and priority findings", recorded("effectivenessConclusion", details.values.overallConclusion)],
    ["Follow-up audit date", recorded("followUpDate")], ["Follow-up scope", recorded("followUpScope")],
    ["Report issue date", recorded("reportIssueDate")], ["Distribution", recorded("distribution")],
  ]);
  collection(conclusion, "signOff");
  const attachments = section("attachments", "End of Report — attachments and supporting records");
  attachments.tables.push({ title: "Supporting records", columns: ["Record", "Reference / file name", "Availability"],
    rows: [...(plan ? [["Audit plan / programme", value(plan.qaqcReference ?? plan.auditTitle), "Linked in Audit workspace"]] : []),
      ["Audit checklists and working notes", String(checklist.length), "Included in this report where recorded"],
      ...evidence.map(file => ["Evidence", value(file.fileName), "Retained in Audit workspace"]),
      ...cars.map(car => ["Non-conformity / CAPA response", value(findings.find(f => f.id === car.findingId)?.reference), "Linked in CAR register"])] });
  attachments.notes.push("Photographs are embedded in the PDF when available. Other supporting files remain linked in the Audit workspace; listing a document is not a claim that it has been signed or approved.");
  return sections;
}