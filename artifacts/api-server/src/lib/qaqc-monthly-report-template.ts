import { readFile } from "node:fs/promises";
import { DOMParser, type Element } from "@xmldom/xmldom";
import { strFromU8, unzipSync } from "fflate";
import type { QaqcReportExport } from "./qaqc-reporting-export";

export const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const UNMAPPED = "To be mapped";
export const children = (e: Element, tag?: string): Element[] =>
  Array.from(e.childNodes).filter((n): n is Element => n.nodeType === 1 && (!tag || n.localName === tag));
export const child = (e: Element | undefined, tag: string) => e && children(e, tag)[0];
export const attr = (e: Element | undefined, name: string) => e?.getAttributeNS(W, name) ?? "";
export const descendants = (e: Element, tag: string) => Array.from(e.getElementsByTagNameNS(W, tag));
export async function monthlyAsset(name: string) {
  try { return await readFile(new URL(`./${name}`, import.meta.url)); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return readFile(new URL(`../assets/${name}`, import.meta.url));
  }
}
const text = (v: unknown): string => v === null || v === undefined || v === "" ? UNMAPPED : String(v);
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : undefined;
const decimal = (v: unknown, places = 1) => num(v)?.toFixed(places) ?? UNMAPPED;
const percent = (v: unknown) => num(v) === undefined ? UNMAPPED : `${decimal(v)}%`;
export function monthlyDate(v: unknown) {
  const s = v instanceof Date ? v.toISOString() : String(v ?? "");
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(s);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : UNMAPPED;
}
function period(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))
    ? new Date(`${v}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) : UNMAPPED;
}
const rows = (v: unknown): Record<string, any>[] => Array.isArray(v) ? v.filter(r => r && typeof r === "object") : [];
const variance = (v: unknown, unit = "pp") => num(v) === undefined ? UNMAPPED
  : `${Number(v) > 0 ? "▲ +" : Number(v) < 0 ? "▼ " : "● "}${decimal(v)} ${unit}${v === 0 ? " (no change)" : ""}`;

/** Changes values only; all table/run styling comes from the customer's Word file.
 * Unmatched template fields deliberately do not inherit its illustrative values.
 */
export async function buildMonthlyReportDocument(report: QaqcReportExport) {
  const files = unzipSync(await monthlyAsset("qaqc-monthly-report-template.docx"));
  const doc = new DOMParser().parseFromString(strFromU8(files["word/document.xml"]!), "application/xml");
  const body = descendants(doc.documentElement!, "body")[0]!;
  const blocks = children(body); // Stable coordinates in the supplied, versioned template.
  const d = report.data as Record<string, any>, c = report.computed as Record<string, any>;
  const baseline = report.baseline as Record<string, any>;
  const set = (p: Element, value: unknown, color?: string) => {
    const run = child(p, "r")!;
    const templateRun = run.cloneNode(true) as Element;
    for (const node of children(p).filter(n => n.localName !== "pPr")) p.removeChild(node);
    for (const node of children(templateRun).filter(n => n.localName !== "rPr")) templateRun.removeChild(node);
    if (color) {
      let props = child(templateRun, "rPr");
      if (!props) { props = doc.createElementNS(W, "w:rPr"); templateRun.appendChild(props); }
      let col = child(props, "color");
      if (!col) { col = doc.createElementNS(W, "w:color"); props.appendChild(col); }
      col.setAttributeNS(W, "w:val", color);
    }
    const t = doc.createElementNS(W, "w:t"); t.appendChild(doc.createTextNode(text(value)));
    templateRun.appendChild(t); p.appendChild(templateRun);
  };
  const cells = (i: number, r: number) => children(children(blocks[i]!, "tr")[r]!, "tc");
  const put = (i: number, r: number, col: number, v: unknown, p = 0, color?: string) =>
    set(children(cells(i, r)[col]!, "p")[p]!, v, color);
  const para = (i: number, v: unknown, color?: string) => set(blocks[i]!, v, color);
  const tone = (v: unknown) => Number(v) > 0 ? "2E7D32" : Number(v) < 0 ? "C0392B" : "66666A";
  const rebuild = (i: number, data: unknown, values: (r: Record<string, any>) => unknown[], empty: string) => {
    const table = blocks[i]!, originalRows = children(table, "tr"), sample = originalRows[1]!;
    for (const r of originalRows.slice(1)) table.removeChild(r);
    const actual = rows(data);
    if (!actual.length) {
      // Replace the entire table; an empty section must not display sample headers.
      const p = children(children(sample, "tc")[0]!, "p")[0]!.cloneNode(true) as Element;
      set(p, empty); body.replaceChild(p, table); return;
    }
    for (const row of actual) {
      const clone = sample.cloneNode(true) as Element;
      const vals = values(row);
      children(clone, "tc").forEach((cell, j) => {
        const ps = children(cell, "p"); set(ps[0]!, vals[j]);
        ps.slice(1).forEach(p => cell.removeChild(p));
      });
      table.appendChild(clone);
    }
  };
  const pqi = c.pqi ?? {}, mat = c.material ?? {}, qt = c.qtbt ?? {}, metrics = c.metrics ?? {};
  const m = d.material ?? {}, q = d.qtbt ?? {};
  const month = period(report.period), project = text(report.projectName);
  put(0, 0, 0, project, 1); put(0, 0, 0, `Cost centre  ${text(report.costCentre)}`, 2);
  put(0, 0, 1, month, 1);
  put(3, 0, 0, decimal(pqi.accumulated), 1);
  put(3, 0, 0, `${variance(pqi.variance, "pts")} vs last month`, 2, tone(pqi.variance));
  for (const [col, key] of [[1, "external_ncr"], [2, "internal_ncr"]] as const) {
    put(3, 0, col, metrics[key]?.open, 1);
    put(3, 0, col, `${text(metrics[key]?.issued)} issued · ${text(metrics[key]?.closed)} closed`, 2);
  }
  put(3, 0, 3, c.manpower?.count, 1);
  put(3, 0, 3, `${rows(d.manpower).length} departments`, 2);
  [metrics.rfi, metrics.rmi, mat].forEach((v, col) => {
    put(3, 1, col, percent(v?.monthlyRate), 1);
    put(3, 1, col, `${text(v?.closed)} closed · ${text(v?.issued)} issued this month`, 2);
  });
  put(3, 1, 3, decimal(qt.manhours, 2), 1);
  put(3, 1, 3, `${text(q.talkCount)} talks · ${text(q.attendance)} attendees`, 2);
  const briefCell = cells(5, 0)[0]!, briefPs = children(briefCell, "p");
  set(briefPs[0]!, d.narrative); briefPs.slice(1).forEach(p => briefCell.removeChild(p));
  const confirmation = d.assessmentConfirmed === true ? "✔ Reviewed and confirmed" : "Not confirmed";
  para(6, d.assessmentConfirmed === true ? `${confirmation} by the submitter` : confirmation,
    d.assessmentConfirmed === true ? "2E7D32" : "66666A");
  put(9, 0, 1, project); put(9, 0, 3, month); put(9, 1, 1, report.costCentre);
  put(11, 0, 1, d.pqpStatus === "Others" ? d.pqpOther : d.pqpStatus);
  const pqpNA = !d.pqpStatus || d.pqpStatus === "Under Preparation";
  put(11, 0, 3, pqpNA ? "Not applicable" : monthlyDate(d.pqpSubmittedDate));
  put(11, 1, 1, /^Approved [ABC]$/.test(d.pqpStatus ?? "") ? monthlyDate(d.pqpApprovedDate) : "Not applicable");
  put(14, 0, 1, d.reportReference); put(14, 0, 3, monthlyDate(d.reportFrom)); put(14, 1, 1, monthlyDate(d.reportTo));
  // Last meeting date is the occurrence date; next planned date is not an outcome.
  rebuild(16, d.meetings, r => [r.type, monthlyDate(r.lastDate), UNMAPPED, UNMAPPED], "No meeting added");
  para(17, `${rows(d.meetings).length} meetings conducted this month.`);
  const audit = d.internalAudit ?? {};
  put(19, 0, 1, typeof audit.conducted === "boolean" ? audit.conducted ? "Yes" : "No" : UNMAPPED);
  put(19, 0, 3, audit.conducted === false ? "Not applicable" : monthlyDate(audit.lastDate));
  put(19, 1, 1, audit.conducted === false ? "Not applicable" : monthlyDate(audit.nextDate));
  const manpowerTotalRow = children(blocks[21]!, "tr").at(-1)!.cloneNode(true) as Element;
  rebuild(21, d.manpower, r => [r.department, r.count, typeof r.approvalRequired === "boolean" ? r.approvalRequired ? "Yes" : "No" : UNMAPPED], "No manpower rows added");
  if (rows(d.manpower).length) {
    const table = blocks[21]!, total = manpowerTotalRow;
    children(total, "tc").forEach((cell, j) => set(children(cell, "p")[0]!, ["Total manpower", text(c.manpower?.count), ""][j] || " "));
    table.appendChild(total);
  }
  const keys = ["external_ncr", "internal_ncr", "rfi", "rmi"];
  const metricRows: Array<[number, string, boolean?]> = [
    [2,"previousIssued"],[3,"previousClosed"],[4,"previousAccumulatedRate",true],
    [6,"issued"],[7,"closed"],[8,"monthlyRate",true],[10,"accumulatedIssued"],
    [11,"accumulatedClosed"],[12,"accumulatedRate",true],
  ];
  keys.forEach((key, col) => {
    const v = metrics[key] ?? {};
    metricRows.forEach(([r, field, pct]) => put(23, r, col + 1, pct ? percent(v[field]) : v[field]));
    put(23, 14, col + 1, variance(v.variance), 0, tone(v.variance));
    put(23, 15, col + 1, col < 2 ? text(v.open) : "n/a");
  });
  para(24, "Cumulative closure % = closed ÷ accumulated issued (100% when nothing issued). Closure rate this month = closed this month ÷ issued this month, using the saved system calculation. Variance = change in cumulative closure %, in percentage points (pp). Open count and ageing are tracked for NCRs only.");
  // Current bands 0–15 / 15–45 / >45 cannot be split into the template's
  // 16–30 / 31–60 / >60 bands. Never manufacture those figures.
  keys.slice(0, 2).forEach((key, i) => {
    const ageing = rows(d.metrics?.[key]?.ageing);
    const sum = ageing.reduce((s, r) => s + Number(r.count ?? 0), 0), open = metrics[key]?.open;
    for (let col = 1; col <= 4; col++) put(26, i + 1, col,
      col === 1 && Array.isArray(d.metrics?.[key]?.ageing)
        ? ageing.filter(r => r.bucket === "0-15").reduce((s,r) => s + Number(r.count ?? 0), 0) : UNMAPPED);
    put(26, i + 1, 5, Array.isArray(d.metrics?.[key]?.ageing) ? sum : UNMAPPED);
    const known = Array.isArray(d.metrics?.[key]?.ageing) && num(open) !== undefined;
    put(26, i + 1, 6, known ? `${sum === open ? "✔" : "✖"} ${sum} / ${open}` : UNMAPPED, 0,
      known ? sum === open ? "2E7D32" : "C0392B" : "66666A");
  });
  [pqi.previous,pqi.accumulated,pqi.variance,pqi.monthly].forEach((v,i) => put(29,0,i,
    i === 2 && num(v) !== undefined && Number(v) > 0 ? `+${decimal(v)}` : decimal(v),1,i === 2 ? tone(v) : undefined));
  put(29,0,2,num(pqi.variance) === undefined ? UNMAPPED : Number(pqi.variance)>0 ? "▲ improved vs last month" : Number(pqi.variance)<0 ? "▼ declined vs last month" : "● no change",2,tone(pqi.variance));
  put(31,0,1,UNMAPPED,0);
  // No cross-project aggregate is read here: preserve report/project RBAC.
  [[mat.previousIssued,mat.issued,mat.accumulatedIssued], [mat.previousClosed,mat.closed,mat.accumulatedClosed],
    [num(mat.previousIssued)! - num(mat.previousClosed)!, "—", mat.open],
    [num(mat.previousIssued) === undefined || num(mat.previousClosed) === undefined ? UNMAPPED
      : percent(mat.previousIssued === 0 ? (mat.previousClosed === 0 ? 100 : 0) : mat.previousClosed / mat.previousIssued * 100),
    percent(mat.monthlyRate),percent(mat.accumulatedRate)]].forEach((vs,i) => vs.forEach((v,j) =>
      put(34,i+1,j+1,typeof v === "number" && !Number.isFinite(v) ? UNMAPPED : v)));
  put(34,5,1,variance(mat.variance,"pts"),0,tone(mat.variance));
  put(36,0,1,typeof m.osdAvailable === "boolean" ? m.osdAvailable ? "Yes" : "No" : UNMAPPED);
  const osd = (v: unknown) => m.osdAvailable === false ? "Not applicable" : text(v);
  put(36,0,3,osd(m.osdMirns)); put(36,1,1,osd(m.overage)); put(36,1,3,osd(m.shortage));
  put(36,2,1,osd(m.damage)); put(36,2,3,osd(m.defective));
  const statusKeys = ["approved","onHold","rejectedDoNotUse","rejectedReturn","hazardous","handleWithCare"];
  statusKeys.forEach((k,i) => {
    put(39,i+1,1,m[k]);
    put(39,i+1,2,num(m[k]) !== undefined && num(m.totalItems) !== undefined && m.totalItems > 0
      ? percent(m[k] / m.totalItems * 100) : m.totalItems === 0 && m[k] === 0 ? "0.0%" : UNMAPPED);
  });
  const tagsKnown = statusKeys.every(k => num(m[k]) !== undefined) && num(m.totalItems) !== undefined;
  const tagSum = statusKeys.reduce((s,k) => s + Number(m[k] ?? 0),0), tagsMatch = tagSum === m.totalItems;
  put(39,7,1,m.totalItems); put(39,7,2,num(m.totalItems) === undefined ? UNMAPPED : "100.0%");
  para(40,tagsKnown ? `${tagsMatch ? "✔" : "✖"} Status tags total ${tagSum} ${tagsMatch ? "=" : "≠"} Total items in MIRNs ${m.totalItems}` : UNMAPPED,
    tagsKnown ? tagsMatch ? "2E7D32" : "C0392B" : "66666A");
  const qb = baseline.qtbt ?? {};
  [[qb.accumulatedTalkCount,q.talkCount,qt.accumulatedTalkCount],
    [decimal(qb.accumulatedManhours,2),decimal(qt.manhours,2),decimal(qt.accumulatedManhours,2)],
    ["—",q.attendance,"—"],["—",q.durationMinutes,"—"]].forEach((vs,i) => vs.forEach((v,j) => put(42,i+1,j+1,v)));
  ["drawings","submittals"].forEach((key,i) => {
    const v = d.documents?.[key] ?? {}, fields = ["approved","resubmitted","rejected","underReview"];
    const total = fields.every(k => num(v[k]) !== undefined) ? fields.reduce((s,k) => s + v[k],0) : UNMAPPED;
    [...fields.map(k => text(v[k])),total,decimal(v.clientReviewDays),decimal(v.internalReviewDays)].forEach((v,j) => put(45,i+1,j+1,v));
    put(48,i,1,v.remarks);
  });
  rebuild(50,d.qmsReports,r => [r.documentName,UNMAPPED,UNMAPPED,r.remarks],"No QMS report rows added");
  body.removeChild(blocks[51]!);
  put(53,0,0,confirmation,1,d.assessmentConfirmed === true ? "2E7D32" : "66666A");
  put(53,0,1,report.submittedByName,1); put(53,0,1,UNMAPPED,2); // No report signatory title captured.
  put(53,0,2,monthlyDate(report.submittedAt),1); put(53,0,2,`Report ID  ${text(report.referenceNumber ?? report.id)}`,2);
  // Explicitly remove the reviewer appendix, sample header, comments and sample footer.
  for (const block of blocks.slice(54)) if (block.localName !== "sectPr") body.removeChild(block);
  return { body, project, month };
}
