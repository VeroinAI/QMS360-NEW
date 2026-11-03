const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Metrics Display/Edit uses a named month; storage remains the ISO reporting period. */
export function metricsReportPeriod(period: string): string {
  const match = /^(\d{4})-(0[1-9]|1[0-2])(?:-\d{2})?$/.exec(period);
  return match ? `${MONTHS[Number(match[2]) - 1]}, ${match[1]}` : period || '—';
}
