import type { QaqcReportExport } from "./qaqc-reporting-export";
import type { DashboardChart } from "./qaqc-monthly-dashboard-data";
import type { PresentationDashboard } from "./qaqc-monthly-dashboard-pdf";
import { monthlyDate, UNMAPPED } from "./qaqc-monthly-report-template";

type Obj = Record<string, any>;
type Count = number | null;
const disciplines = ["Civil", "Structural", "Mechanical", "Electrical", "Instrumentation"];
const statuses = ["approved", "resubmit", "rejected", "underReview"];
const statusLabels = ["Approved", "Resubmit", "Rejected", "Under review"];
const entities = ["Client", "Algihaz", "Supplier"];
const reviewStatuses = ["underReview", "A", "B", "C", "D", "E"];
const buckets = ["upTo7", "days8To30", "over30"];
const types = ["Drawings", "Material Submittals", "Method Statements", "ITPs", "RFIs", "Procedures", "Calculations", "Vendors"];
const statusColors = ["06AEBB", "EB9823", "D58BCB", "BBA9D2"];
const number = (v: unknown): Count => typeof v === "number" && Number.isFinite(v) ? v : null;
const sum = (vs: Count[]): Count => vs.some(v => v === null) ? null : vs.reduce<number>((s, v) => s + v!, 0);
const diff = (v: Count, b: Count): Count => v === null || b === null ? null : v - b;
const count = (v: Count) => v === null ? UNMAPPED : v.toLocaleString("en-US");
const signed = (v: Count) => v === null ? UNMAPPED : `${v > 0 ? "+" : v < 0 ? "−" : ""}${count(Math.abs(v))}`;
const change = (v: Count) => v === null ? UNMAPPED : `${v > 0 ? "▲" : v < 0 ? "▼" : "●"} ${signed(v)}`;
const text = (v: unknown) => v == null || String(v).trim() === "" ? UNMAPPED : String(v);
const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
const rows = (v: unknown): Obj[] => Array.isArray(v) ? v.filter(r => r && typeof r === "object") : [];
const tone = (v: Count, kind = "neutral") => v === null || v === 0 || kind === "neutral" ? "66666A" : (kind === "approved" ? v > 0 : v < 0) ? "2E7D32" : "C0392B";

/** Workbook D-001–D-117. Comparisons use the historical report's saved baseline,
 * never today's previous log. Explicit zero is distinct from a missing current input. */
export function dailyDashboardData(report: QaqcReportExport): PresentationDashboard {
  const d = report.data as Obj, b = report.baseline as Obj, c = report.computed as Obj;
  const current = (...path: string[]) => number(path.reduce((o, k) => o?.[k], d));
  const previous = (...path: string[]) => number(path.reduce((o, k) => o?.[k], b)) ?? 0;
  const total = (section: string, discipline: string) => number(c.disciplineTotals?.[`${section}.${discipline}`])
    ?? sum(statuses.map(s => current("disciplines", section, discipline, s)));
  const priorTotal = (section: string, discipline: string) => sum(statuses.map(s => previous("disciplines", section, discipline, s)))!;
  const section = (key: string, status?: string) => sum(disciplines.map(x => status ? current("disciplines", key, x, status) : total(key, x)));
  const priorSection = (key: string, status?: string) => sum(disciplines.map(x => status ? previous("disciplines", key, x, status) : priorTotal(key, x)))!;
  const combined = (status?: string) => sum(["drawings", "submittals"].map(k => section(k, status)));
  const priorCombined = (status?: string) => sum(["drawings", "submittals"].map(k => priorSection(k, status)))!;
  const bucketTotal = (entity: string, bucket: string) => sum(reviewStatuses.map(s => current("pending", entity, s, bucket)));
  const pending = (entity: string) => number(c.pendingTotals?.[entity]) ?? sum(buckets.map(k => bucketTotal(entity, k)));
  const underReview = (entity: string) => sum(buckets.map(k => current("pending", entity, "underReview", k)));
  const allPending = sum(entities.map(pending)), allAged = sum(entities.map(e => bucketTotal(e, "over30")));
  const date = monthlyDate(report.period), project = text(report.projectName), team = report.projectTeam ?? {};
  const values: Record<string, string> = {
    "Project line": `${text(report.projectCode)} · ${project}`,
    "Project and date": `${project} · ${date}`,
    "Report date": `REPORT DATE\n${date}`,
    "Team line": `Project team: PM – ${text(team.pmName)}   ||   PE – ${text(team.peName)}   ||   DC – ${text(team.dcName)}   ||   Cost centre ${text(report.costCentre)}`,
    "Under review total chip 1 value": count(sum(entities.map(underReview))),
    "Report link": report.dailyReportPdfUrl ? "Detailed report: Export Report PDF" : `Detailed report: ${UNMAPPED}`,
    "KPI all aged value": count(allAged), "KPI all aged sub": `of ${count(allPending)} pending`,
  };
  const tones: Record<string, string> = {}, charts: Record<number, DashboardChart> = {};
  const tables: NonNullable<PresentationDashboard["tables"]> = {};
  const series = (name: string, values: Count[], color: string) => ({ name, values, color });
  const bar = (categories: string[], name: string, vs: Count[], color = "582C83", options: Partial<DashboardChart> = {}): DashboardChart =>
    ({ categories, series: [series(name, vs, color)], ...options });
  for (const [index, key] of ["submittals", "drawings", "all"].entries()) {
    const label = ["SUBMITTALS", "DRAWINGS", "SUBMISSION TOTAL"][index]!;
    const now = [undefined, ...statuses].map(s => key === "all" ? combined(s) : section(key, s));
    const prior = [undefined, ...statuses].map(s => key === "all" ? priorCombined(s) : priorSection(key, s));
    const changes = now.map((v, i) => diff(v, prior[i]!));
    now.forEach((v, i) => {
      values[`Added ${label} chip ${i + 1} value`] = signed(changes[i]!);
      values[`Cum ${label} chip ${i + 1} value`] = count(v);
      tones[`Added ${label} chip ${i + 1} value`] = tone(changes[i]!, statuses[i - 1]);
    });
    const opts = { compact: true, pointColors: ["582C83", ...statusColors], hideLabels: true };
    charts[index + 1] = bar(["Total", ...statusLabels], label, changes, "582C83", { ...opts, signed: true });
    charts[index + 5] = bar(["Total", ...statusLabels], label, now, "582C83", opts);
  }
  const correspondence = ["outgoing", "incoming"].map(key => current("correspondence", key));
  const correspondenceChanges = correspondence.map((v, i) => diff(v, previous("correspondence", ["outgoing", "incoming"][i]!)));
  correspondence.forEach((v, i) => {
    values[`Added CORRESPONDENCE chip ${i + 1} value`] = signed(correspondenceChanges[i]!);
    values[`Cum CORRESPONDENCE chip ${i + 1} value`] = count(v);
  });
  charts[4] = bar(["Outgoing", "Incoming"], "Correspondence", correspondenceChanges, "582C83", { pointColors: ["582C83", "06AEBB"], compact: true });
  charts[8] = bar(["Outgoing", "Incoming"], "Correspondence", correspondence, "582C83", { pointColors: ["582C83", "06AEBB"], compact: true });
  const revisions = ["drawings", "submittals"].flatMap(key => rows(d.revisions?.[key]).map(row => {
    const prior = number(rows(b.revisions?.[key]).find(p => norm(p.name) === norm(row.name))?.value) ?? 0;
    const now = number(row.value);
    const cumulative = section(key);
    // The read-only percentage is not persisted as a separate column. This is
    // the same formula and denominator used by ApprovedRevisions in the form.
    const percentage = now === null || cumulative === null ? null : cumulative > 0 ? now / cumulative * 100 : 0;
    return { label: `${key === "drawings" ? "Drawing" : "Submittal"} rev ${text(row.name)}`, percentage, change: diff(now, prior) };
  }));
  charts[9] = bar(revisions.map(r => `${r.label}  ${signed(r.change)}`), "% of overall cum.", revisions.map(r => r.percentage), "582C83", { compact: true, percent: true });
  charts[10] = bar(entities, "Under review", entities.map(underReview), "582C83", { compact: true });
  const rejectedKeys = ["drawing", "materials", "calculation", "general"];
  const rejected = rejectedKeys.map(k => current("rejectedSubmissions", k));
  const rejectedChange = rejected.map((v, i) => diff(v, previous("rejectedSubmissions", rejectedKeys[i]!)));
  values["Rejected total chip 1 value"] = count(sum(rejected));
  values["Rejected total chip 1 label"] = `${signed(sum(rejectedChange))} since yesterday`;
  tones["Rejected total chip 1 label"] = tone(sum(rejectedChange), "rejected");
  charts[11] = bar(rejectedKeys.map((k, i) => `${k[0]!.toUpperCase()}${k.slice(1)}  ${signed(rejectedChange[i]!)}`), "Rejected", rejected, "D58BCB", { compact: true });
  tables["Pending days table"] = {
    rows: [["Party", "≤7 d", "8–30 d", "≥31 d", "Total"],
      ...entities.map(e => [e, ...buckets.map(k => count(bucketTotal(e, k))), count(pending(e))]),
      ["All parties", ...buckets.map(k => count(sum(entities.map(e => bucketTotal(e, k))))), count(allPending)]],
  };
  for (const [i, key] of ["drawings", "submittals"].entries()) {
    const label = key === "drawings" ? "Drawings" : "Submittals", delta = diff(section(key), priorSection(key));
    values[`${label} title`] = `${label} · ${count(section(key))}`;
    values[`${label} change`] = `${change(delta)} since yesterday`;
    tones[`${label} change`] = tone(delta);
    charts[12 + i] = {
      categories: disciplines,
      series: statuses.map((s, j) => series(statusLabels[j]!, disciplines.map(x => current("disciplines", key, x, s)), statusColors[j]!)),
      hideLabels: true,
    };
    const tableTones: Record<string, string> = {};
    const tableRows = disciplines.map((x, r) => {
      const delta = diff(total(key, x), priorTotal(key, x));
      tableTones[`${r + 1}:6`] = tone(delta);
      return [x, ...statuses.map(s => count(current("disciplines", key, x, s))), count(total(key, x)), change(delta)];
    });
    tables[`${label} table`] = { rows: [["Discipline", "Approved", "Resubmit", "Rejected", "Review", "Total", "Change"], ...tableRows,
      ["Overall", ...statuses.map(s => count(section(key, s))), count(section(key)), change(delta)]], tones: tableTones };
  }
  const activeTypes = [...types, ...["CVs", "PQP", "IFR"].filter(k => d.documentTypes?.[k] !== undefined || b.documentTypes?.[k] !== undefined)];
  charts[14] = bar(activeTypes.map(k => `${({ ITPs: "ITP", Vendors: "Vendor Documents" } as Record<string, string>)[k] ?? k}  ${change(diff(current("documentTypes", k), previous("documentTypes", k)))}`),
    "Current", activeTypes.map(k => current("documentTypes", k)));
  charts[15] = bar(revisions.map(r => r.label), "% of overall cum.", revisions.map(r => r.percentage), "582C83", { percent: true, pointColors: revisions.map(r => r.label.startsWith("Drawing") ? "582C83" : "06AEBB") });
  if (!revisions.length) { charts[9]!.hide = "No revision rows added"; charts[15]!.hide = "No revision rows added"; }
  values["Revision note"] = `Approved: ${count(combined("approved"))} documents\nRevision shares use their document type's cumulative total: Drawings ${count(section("drawings"))}; Submittals ${count(section("submittals"))}.`;
  entities.forEach(e => {
    values[`KPI ${e} value`] = count(pending(e));
    values[`KPI ${e} sub`] = `${count(bucketTotal(e, "over30"))} pending ≥ 31 days`;
  });
  charts[16] = { categories: entities, series: buckets.map((k, i) => series(["≤7 days", "8–30 days", "≥31 days"][i]!, entities.map(e => bucketTotal(e, k)), ["6DBE6D", "EB9823", "E9776D"][i]!)) };
  charts[17] = { categories: ["Under review", "Status A", "Status B", "Status C", "Status D", "Status E"],
    series: entities.map((e, i) => series(e, reviewStatuses.map(s => current("pending", e, s, "over30")), ["582C83", "EB9823", "06AEBB"][i]!)), hideZeroLabels: true };
  return { values, tones, charts, tables, links: report.dailyReportPdfUrl ? { "Report link": report.dailyReportPdfUrl } : {} };
}
