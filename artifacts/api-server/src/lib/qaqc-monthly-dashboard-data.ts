import type { QaqcReportExport } from "./qaqc-reporting-export";
import { monthlyDate, UNMAPPED } from "./qaqc-monthly-report-template";

type Obj = Record<string, any>;
export type DashboardChart = {
  categories: string[];
  series: { name: string; values: (number | null)[]; color: string }[];
  hide?: string;
  compact?: boolean;
  percent?: boolean;
  signed?: boolean;
  hideLabels?: boolean;
  hideZeroLabels?: boolean;
  pointColors?: string[];
};
const keys = ["external_ncr", "internal_ncr", "rfi", "rmi"];
const labels = ["External NCR", "Internal NCR", "RFI", "RMI"];
const n = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const text = (v: unknown) => v === null || v === undefined || String(v).trim() === "" ? UNMAPPED : String(v);
const f = (v: unknown, places = 0) => n(v) === null ? UNMAPPED : Number(v).toFixed(places);
const pct = (v: unknown) => n(v) === null ? UNMAPPED : `${f(v, 1)}%`;
const rows = (v: unknown): Obj[] => Array.isArray(v) ? v.filter(r => r && typeof r === "object") : [];
const add = (values: unknown[]) => values.every(v => n(v) !== null) ? values.reduce<number>((s, v) => s + Number(v), 0) : null;
const delta = (v: unknown, unit = "pts") => n(v) === null ? UNMAPPED : `${Number(v) > 0 ? "▲ +" : Number(v) < 0 ? "▼ " : "● "}${f(v, 1)} ${unit}`;
export const dashboardTone = (v: unknown) => n(v) === null || v === 0 ? "66666A" : Number(v) > 0 ? "2E7D32" : "C0392B";

/** Workbook D-001–D-129. Saved system calculations are authoritative, never the sample PPT figures. */
export function monthlyDashboardData(report: QaqcReportExport) {
  const d = report.data as Obj, c = report.computed as Obj, b = report.baseline as Obj;
  const metric = (key: string): Obj => c.metrics?.[key] ?? {};
  const material: Obj = c.material ?? {}, mat: Obj = d.material ?? {}, q: Obj = d.qtbt ?? {}, qt: Obj = c.qtbt ?? {};
  const pqi: Obj = c.pqi ?? {}, audit: Obj = d.internalAudit ?? {};
  const meetings = rows(d.meetings), qms = rows(d.qmsReports), manpower = rows(d.manpower);
  const ext = metric(keys[0]!), int = metric(keys[1]!), rfi = metric("rfi");
  const date = (v: unknown) => monthlyDate(v);
  const auditDate = (v: unknown) => audit.conducted === false ? "N/A" : date(v);
  const base = (m: Obj) => n(m.previousIssued) !== null && n(m.previousClosed) !== null && n(m.issued) !== null
    ? m.previousIssued - m.previousClosed + m.issued : null;
  const pqp = d.pqpStatus === "Others" ? text(d.pqpOther) : text(d.pqpStatus);
  const month = /^\d{4}-\d{2}-\d{2}$/.test(report.period) ? new Date(`${report.period}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) : UNMAPPED;
  const count = c.manpower?.count;
  const portfolio = report.monthlyDashboardPortfolio;
  const brief = text(d.narrative);
  const excerpt = brief.length > 300 ? `${brief.slice(0, 300).replace(/\s+\S*$/, "")}…` : brief;
  const values: Record<string, string> = {
    "Project and period": `${text(report.projectName)} · ${month}`,
    "KPI PQI value": f(pqi.accumulated, 1),
    "KPI PQI sub": `${delta(pqi.variance)} vs last month`,
    "KPI Open NCRs value": f(add([ext.open, int.open])),
    "KPI Open NCRs sub": `Ext ${f(ext.open)} · Int ${f(int.open)}`,
    "KPI RFI value": pct(rfi.monthlyRate),
    "KPI RFI sub": `${f(rfi.closed)} of ${f(base(rfi))} closed`,
    "KPI MIRN value": pct(material.monthlyRate),
    "KPI MIRN sub": `${f(material.closed)} of ${f(base(material))} closed`,
    "KPI QTBT value": f(qt.manhours, 2),
    "KPI QTBT sub": `${f(q.talkCount)} talks · ${f(q.attendance)} attendees`,
    "PQI value": f(pqi.accumulated, 1),
    "PQI notes": `This month ${f(pqi.monthly, 1)}\nPortfolio avg: ${portfolio?.status === "complete" && portfolio.average != null ? f(portfolio.average, 1) : portfolio?.status === "pending" ? `Pending (${portfolio.reportedProjectCount} of ${portfolio.activeProjectCount})` : "No submitted reports"}`,
    "Gov value 1": pqp, "Gov value 2": auditDate(audit.lastDate), "Gov value 3": auditDate(audit.nextDate),
    "Gov value 4": String(meetings.length), "Gov value 5": `${f(count)} people`,
    "Brief text": excerpt,
    "KPI MIRN issued value": f(material.issued), "KPI MIRN issued sub": `${f(material.accumulatedIssued)} accumulated`,
    "KPI MIRN closed value": f(material.closed), "KPI MIRN closed sub": `${f(material.accumulatedClosed)} accumulated`,
    "KPI MIRN rate value": pct(material.monthlyRate), "KPI MIRN rate sub": `${f(n(material.accumulatedIssued) !== null && n(material.accumulatedClosed) !== null ? material.accumulatedIssued - material.accumulatedClosed : null)} MIRNs open`,
    "KPI MIRN cumulative value": pct(material.accumulatedRate), "KPI MIRN cumulative sub": `${delta(material.variance)} vs last month`,
    "KPI talks value": f(q.talkCount), "KPI talks sub": `${f(qt.accumulatedTalkCount)} accumulated`,
    "KPI attendees value": f(q.attendance), "KPI attendees sub": `${f(q.durationMinutes)} min per talk`,
    "KPI manhours value": f(qt.manhours, 2), "KPI manhours sub": `${f(b.qtbt?.accumulatedManhours, 2)} before`,
    "KPI acc manhours value": f(qt.accumulatedManhours, 2), "KPI acc manhours sub": `${f(qt.accumulatedTalkCount)} talks to date`,
    "PQP value 1": pqp, "PQP value 2": !d.pqpStatus || d.pqpStatus === "Under Preparation" ? "Not applicable" : date(d.pqpSubmittedDate),
    "PQP value 3": /^Approved [ABC]$/.test(d.pqpStatus ?? "") ? date(d.pqpApprovedDate) : "Not applicable",
    "Audit value 1": typeof audit.conducted === "boolean" ? audit.conducted ? "Yes" : "No" : UNMAPPED,
    "Audit value 2": auditDate(audit.lastDate), "Audit value 3": auditDate(audit.nextDate),
    "Last report ref": d.reportReference || d.reportFrom || d.reportTo ? `Last report sent to client: ${text(d.reportReference)} (${date(d.reportFrom)} to ${date(d.reportTo)})` : "",
    "Meetings title": `Meetings conducted (${meetings.length})`,
    "QMS title": `QMS Document Register (${qms.length})`,
  };
  const tones: Record<string, string> = { "KPI PQI sub": dashboardTone(pqi.variance), "KPI MIRN cumulative sub": dashboardTone(material.variance) };
  labels.forEach((label, i) => {
    const m = metric(keys[i]!);
    values[`${label} rate`] = pct(m.monthlyRate);
    values[`${label} cumulative`] = `Cumulative ${pct(m.accumulatedRate)}  ${delta(m.variance, "pp")}`;
    values[`${label} counts`] = `${f(m.issued)} issued · ${f(m.closed)} closed${i < 2 ? ` · ${f(m.open)} open` : ""}`;
    tones[`${label} cumulative`] = dashboardTone(m.variance);
  });
  const statusKeys = ["approved", "onHold", "rejectedDoNotUse", "rejectedReturn", "hazardous", "handleWithCare"];
  const statusTotal = add(statusKeys.map(k => mat[k]));
  values["Status title"] = `Status of items in MIRNs (${f(statusTotal)} items)`;
  values["Status total"] = `${f(statusTotal)}\nitems`;
  statusKeys.forEach((k, i) => values[`Legend value ${i + 1}`] = f(mat[k]));
  values["OSD footnote"] = mat.osdAvailable === false ? "OSD not applicable" : mat.osdAvailable === true ? `${f(mat.osdMirns)} MIRNs with OSD recorded` : UNMAPPED;
  // Repeating rows use real columns. No date/reference/outcome is fabricated where the current form has none.
  for (let i = 0; i < 4; i++) {
    const r = meetings[i];
    values[`Meeting name ${i + 1}`] = r ? text(r.type) : i === 0 ? "No meeting added" : "";
    values[`Meeting date ${i + 1}`] = r ? date(r.lastDate) : "";
    values[`Meeting outcome ${i + 1}`] = r ? text(r.outcome ?? r.remarks) : "";
  }
  if (meetings.length > 4) values["Meeting outcome 4"] = `${values["Meeting outcome 4"]} · + ${meetings.length - 4} more`;
  for (let i = 0; i < 3; i++) {
    const r = qms[i];
    values[`QMS name ${i + 1}`] = r ? text(r.documentName) : i === 0 ? "No QMS document register rows added" : "";
    values[`QMS date ${i + 1}`] = r ? date(r.date) : "";
    values[`QMS detail ${i + 1}`] = r ? `${text(r.department)} · ${text(r.type)} · ${text(r.status)} · ${text(r.remarks)}` : "";
  }
  if (qms.length > 3) values["QMS detail 3"] = `${values["QMS detail 3"]} · + ${qms.length - 3} more`;
  const noApproval = manpower.filter(r => r.approvalRequired === false).map(r => text(r.department));
  const approvalKnown = manpower.length && manpower.every(r => typeof r.approvalRequired === "boolean");
  values["Manpower note"] = `${f(count)} total\n${!approvalKnown ? UNMAPPED : noApproval.length === manpower.length ? "Client approval not required" : noApproval.length ? `Client approval required for all except ${noApproval.join(", ")}` : "Client approval required for all departments"}`;
  const series = (name: string, values: unknown[], color: string) => ({ name, values: values.map(n), color });
  const charts: Record<number, DashboardChart> = {
    1: { categories: ["Ext NCR", "Int NCR", "RFI", "RMI", "MIRN"], series: [
      series("Last month", [...keys.map(k => metric(k).previousAccumulatedRate), material.previousIssued === 0 ? 100 : n(material.previousIssued) !== null && n(material.previousClosed) !== null ? material.previousClosed / material.previousIssued * 100 : null], "BBA9D2"),
      series("This month", [...keys.map(k => metric(k).accumulatedRate), material.accumulatedRate], "582C83"),
    ] },
    2: { categories: ["Score", "Gap"], series: [series("PQI", [pqi.accumulated, n(pqi.accumulated) !== null ? Math.max(0, 100 - pqi.accumulated) : null], "582C83")] },
    3: { categories: ["External", "Internal"], series: [series("Issued", [ext.issued, int.issued], "EB9823"), series("Closed", [ext.closed, int.closed], "582C83")] },
    4: { categories: ["RFI", "RMI"], series: [series("Issued", keys.slice(2).map(k => metric(k).issued), "EB9823"), series("Closed", keys.slice(2).map(k => metric(k).closed), "582C83")] },
    6: { categories: ["Approved", "On Hold / Quarantine", "Rejected – Do Not Use", "Rejected – Return to Supplier", "Hazardous Material", "Handle & Store with Care"], series: [series("Items", statusKeys.map(k => mat[k]), "06AEBB")] },
    7: { categories: ["Overage", "Shortage", "Damage", "Defective"], series: [series("Qty", [mat.overage, mat.shortage, mat.damage, mat.defective], "EB9823")], ...(mat.osdAvailable === false ? { hide: "OSD not applicable" } : {}) },
    8: { categories: ["Drawings", "Submittals"], series: ["approved", "resubmitted", "rejected", "underReview"].map((k, i) => series(["Approved", "Re-submitted", "Rejected", "Under review"][i]!, [d.documents?.drawings?.[k], d.documents?.submittals?.[k]], ["06AEBB", "EB9823", "D58BCB", "BBA9D2"][i]!)) },
    9: { categories: ["Drawings", "Submittals"], series: [series("Client", [d.documents?.drawings?.clientReviewDays, d.documents?.submittals?.clientReviewDays], "06AEBB"), series("Algihaz", [d.documents?.drawings?.internalReviewDays, d.documents?.submittals?.internalReviewDays], "582C83")] },
    10: { categories: manpower.map(r => text(r.department)), series: [series("Nos", manpower.map(r => r.count), "582C83")] },
  };
  const ageing = keys.slice(0, 2).map(k => rows(d.metrics?.[k]?.ageing));
  const buckets = [...new Set(ageing.flatMap(rs => rs.map(r => String(r.bucket ?? ""))))].filter(Boolean);
  charts[5] = { categories: ["External", "Internal"], series: buckets.map((bucket, i) => series(
    ({ "0-15": "0–15 days", "15-45": "15–45 days", over45: "Over 45 days" } as Record<string, string>)[bucket] ?? bucket,
    ageing.map(rs => rs.some(r => r.bucket === bucket) ? rs.filter(r => r.bucket === bucket).reduce((s, r) => s + Number(r.count ?? 0), 0) : null),
    ["06AEBB", "BBA9D2", "EB9823", "D58BCB"][i % 4]!,
  )) };
  const ageTotals = ageing.map(rs => rs.length ? add(rs.map(r => r.count)) : null);
  const known = ageTotals.every(v => v !== null) && [ext.open, int.open].every(v => n(v) !== null);
  const match = known && ageTotals[0] === ext.open && ageTotals[1] === int.open;
  values["Ageing check"] = !known ? UNMAPPED : match ? "✔ Ageing totals match open NCRs" : "Ageing totals differ from open NCRs";
  tones["Ageing check"] = !known ? "66666A" : match ? "2E7D32" : "C0392B";
  return { values, tones, charts, project: text(report.projectName), month,
    statusMismatch: statusTotal !== null && n(mat.totalItems) !== null && statusTotal !== mat.totalItems };
}
