import { average, number, percent, sum, type DashboardReport } from "./qaqc-consolidated-daily";
type Bag = Record<string, any>;
const KEYS = ["external_ncr", "internal_ncr", "rfi", "rmi"];
const LABELS = ["Ext NCR", "Int NCR", "RFI", "RMI", "MIRN"];
const RATINGS = ["quality", "timeline", "communication", "professionalism", "valueForMoney", "issueHandling"];
const RATING_LABELS = ["Quality of work", "Timeline", "Communication", "Professionalism", "Value for money", "Issue handling"];
const lower = (value: unknown) => String(value ?? "").toLowerCase();
export function previousMonth(period: string, offset = 1) {
  const date = new Date(`${period.slice(0, 7)}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - offset);
  return date.toISOString().slice(0, 7);
}
function quality(reports: DashboardReport[], projects: Bag[]) {
  const metrics = (key: string) => reports.map(row => row.computed?.metrics?.[key]).filter(Boolean);
  const categories = [...KEYS, "material"].map((key, i) => {
    const rows = key === "material" ? reports.map(row => row.computed?.material).filter(Boolean) : metrics(key);
    const issued = sum(rows, row => row.accumulatedIssued), closed = sum(rows, row => row.accumulatedClosed);
    return { name: LABELS[i], key, value: rows.length ? percent(closed, issued, 100) : null,
      target: average(projects.map(project => project.targets?.[key])), issued, closed };
  });
  const issued = sum(categories.slice(0, 4), row => row.issued), closed = sum(categories.slice(0, 4), row => row.closed);
  const ageing = ["external_ncr", "internal_ncr"].map((key, i) => {
    const bucket = (name: string) => sum(reports, row => sum((row.data.metrics?.[key]?.ageing ?? [])
      .filter((entry: Bag) => entry.bucket === name), entry => entry.count));
    return { name: LABELS[i], value: sum(metrics(key), row => row.open),
      upTo15: bucket("0-15"), days15To45: bucket("15-45"), over45: bucket("over45") };
  });
  const documents = ["submittals", "drawings"].map(key => {
    const values = Object.fromEntries(["approved", "resubmitted", "rejected", "underReview"]
      .map(status => [status, sum(reports, row => row.data.documents?.[key]?.[status])]));
    const total = Object.values(values).reduce((a, b) => a + b, 0);
    return { name: key === "drawings" ? "Drawings" : "Submittals", ...values,
      value: percent(values.approved, total), total };
  });
  return { pqi: average(reports.map(row => row.computed.pqi?.accumulated)),
    variance: average(reports.map(row => row.computed.pqi?.variance)),
    target: average(projects.map(project => project.targets?.pqi ?? average(KEYS.map(key => project.targets?.[key])))),
    closure: reports.length ? percent(closed, issued, 100) : null, issued, closed,
    openNcr: reports.length ? sum(ageing, row => row.value) : null,
    externalOpen: ageing[0].value, internalOpen: ageing[1].value, over45: sum(ageing, row => row.over45),
    categories, ageing, documents };
}
function csat(reports: DashboardReport[]) {
  const ratings = RATINGS.map((key, i) => ({ name: RATING_LABELS[i],
    value: average(reports.map(row => row.data.ratings?.[key])) })).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const yes = reports.filter(row => lower(row.data.recommend) === "yes").length;
  return { average: average(reports.flatMap(row => RATINGS.map(key => row.data.ratings?.[key]))),
    responses: reports.length, recommend: percent(yes, reports.length), yes,
    lowest: reports.length ? [...ratings].sort((a, b) => (a.value ?? Infinity) - (b.value ?? Infinity))[0] : null,
    ratings, outcomes: ["Yes", "Partially", "No"].map(name => ({
      name, value: reports.filter(row => lower(row.data.expectations) === name.toLowerCase()).length,
    })) };
}
function lessons(rows: Bag[], period: string, available: boolean) {
  const approved = rows.filter(row => row.state === "approved"), current = approved.filter(row => row.period === period);
  const positive = current.filter(row => lower(row.impact) === "positive").length;
  const negative = current.filter(row => lower(row.impact) === "negative").length;
  const escalated = rows.filter(row => row.state === "submitted" && lower(row.impact) === "negative"
    && lower(row.severity) === "major" && row.level);
  const repeatedCount = current.filter(row => row.repeated).length;
  return { available, logged: available ? current.length : null, positive, negative,
    repeated: available ? percent(repeatedCount, current.length) : null, repeatedCount,
    escalated: available ? escalated.length : null,
    levels: ["P1", "L1", "L2"].map(name => ({ name, value: escalated.filter(row => row.level === name).length })),
    trend: Array.from({ length: 6 }, (_, i) => {
      const month = previousMonth(period, 5 - i), selected = approved.filter(row => row.period === month);
      return { name: month, value: selected.length, positive: selected.filter(row => lower(row.impact) === "positive").length,
        negative: selected.filter(row => lower(row.impact) === "negative").length };
    }),
    severity: ["Minor", "Moderate", "Major"].map(name => ({
      name, value: current.filter(row => lower(row.impact) === "negative" && lower(row.severity) === name.toLowerCase()).length,
    })) };
}
function audit(rows: Bag[], period: string, available: boolean) {
  const current = rows.filter(row => row.period === period);
  const accumulated = rows.filter(row => row.period && row.period <= period);
  const planned = current.length, conducted = current.filter(row => row.conducted).length;
  const major = sum(accumulated, row => row.major), minor = sum(accumulated, row => row.minor);
  const overdue = sum(accumulated, row => row.overdue);
  return { available, planned: available ? planned : null, conducted: available ? conducted : null,
    conductedRate: available ? percent(conducted, planned) : null, openNc: available ? major + minor : null,
    major, minor, overdue: available ? overdue : null, escalated: available ? sum(accumulated, row => row.escalated) : null,
    trend: Array.from({ length: 6 }, (_, i) => {
      const month = previousMonth(period, 5 - i), selected = rows.filter(row => row.period === month);
      return { name: month, value: selected.length, planned: selected.length, conducted: selected.filter(row => row.conducted).length };
    }),
    cars: [{ name: "Closed", value: sum(accumulated, row => row.closedCars) },
      { name: "Open · within date", value: sum(accumulated, row => row.openCars) - overdue }, { name: "Overdue", value: overdue }] };
}

export function monthlyDashboard(reports: DashboardReport[], projects: Bag[], period: string,
  lessonRows: Bag[], auditRows: Bag[], availability: { lessons: boolean; audit: boolean; lessonsProjectIds?: string[]; auditProjectIds?: string[] }) {
  const approved = reports.filter(row => row.reportType === "monthly" && row.state === "approved");
  const current = approved.filter(row => row.period.slice(0, 7) === period);
  // CSAT has a final submission flow, not approval. Only finalized surveys count.
  const surveys = reports.filter(row => row.reportType === "csat" && ["approved", "submitted"].includes(row.state)
    && row.period.slice(0, 7) === period);
  const scorecard = projects.map(project => {
    const mine = current.filter(row => row.projectId === project.id), q = quality(mine, [project]);
    const c = csat(surveys.filter(row => row.projectId === project.id));
    const lessonsAllowed = availability.lessons && (!availability.lessonsProjectIds || availability.lessonsProjectIds.includes(project.id));
    const auditAllowed = availability.audit && (!availability.auditProjectIds || availability.auditProjectIds.includes(project.id));
    const l = lessons(lessonRows.filter(row => row.projectId === project.id), period, lessonsAllowed);
    const a = audit(auditRows.filter(row => row.projectId === project.id), period, auditAllowed);
    const history = approved.filter(row => row.projectId === project.id);
    let monthsBelow = 0, month = period;
    // Break on a missing/nonapproved month; never count gaps as consecutive months.
    while (true) {
      const report = history.find(row => row.period.slice(0, 7) === month);
      if (!report || !KEYS.some(key => {
        const metric = report.computed.metrics?.[key], target = project.targets?.[key] ?? metric?.target;
        return metric && typeof target === "number" && metric.monthlyRate < target;
      })) break;
      monthsBelow++; month = previousMonth(month);
    }
    return { projectId: project.id, projectName: project.name, bu: project.bu, costCentre: project.costCentre,
      reportId: mine[0]?.id ?? null, pqi: q.pqi, target: q.target, closure: q.closure, openNcr: q.openNcr,
      over45: mine.length ? q.over45 : null, csat: c.average, responses: c.responses,
      negativeLessons: lessonsAllowed ? l.negative : null, escalatedLessons: l.escalated,
      openNc: a.openNc, overdueCars: a.overdue, plannedAudits: a.planned, conductedAudits: a.conducted,
      escalation: monthsBelow >= 4 ? "L3" : monthsBelow === 3 ? "L2" : monthsBelow === 2 ? "L1" : "Normal", monthsBelow };
  });
  return { quality: quality(current, projects), csat: csat(surveys),
    lessons: lessons(lessonRows, period, availability.lessons), audit: audit(auditRows, period, availability.audit), scorecard };
}
