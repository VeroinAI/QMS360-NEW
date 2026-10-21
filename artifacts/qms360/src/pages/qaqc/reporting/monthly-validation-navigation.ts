/** Stable form paths for the existing human-readable Monthly Metrics validations. */
export function monthlyIssuePath(message: string): string | undefined {
  const m = message.toLowerCase();
  if (m.includes('confirm') && m.includes('assessment')) return 'assessmentConfirmed';
  if (m.includes('quality assessment brief')) return 'narrative';
  if (m.includes('pqp')) return m.includes('approval date') ? 'pqpApprovedDate' : m.includes('submission date') ? 'pqpSubmittedDate' : m.includes('other pqp') ? 'pqpOther' : 'pqpStatus';
  const meeting = /^meeting (\d+)/i.exec(message);
  if (meeting) return `meetings.${Number(meeting[1]) - 1}.${m.includes('date (from)') || m.includes('from date') ? 'lastDate' : m.includes('date (to)') ? 'nextDate' : 'type'}`;
  if (m.startsWith('report date')) return m.includes('(to)') ? 'reportTo' : 'reportFrom';
  if (m.includes('next internal audit')) return 'internalAudit.nextDate';
  if (m.includes('internal audit conducted date')) return 'internalAudit.lastDate';
  if (m.includes('is internal audit conducted')) return 'internalAudit.conducted';
  if (m.startsWith('add at least one quality manpower')) return 'manpower';
  const manpower = /^quality manpower (\d+)/i.exec(message);
  if (manpower) {
    const field = m.includes('discipline') ? 'department' : m.includes('whether client approval') ? 'approvalRequired' : m.includes('approved and rejected') ? 'approved' : m.includes('approved count') ? 'approved' : m.includes('rejected count') ? 'rejected' : 'count';
    return `manpower.${Number(manpower[1]) - 1}.${field}`;
  }
  const metric = /^(External NCR|Internal NCR|RFI|RMI)(?: ageing (\d+))?:/i.exec(message);
  if (metric) {
    const key = ({ 'external ncr': 'external_ncr', 'internal ncr': 'internal_ncr', rfi: 'rfi', rmi: 'rmi' } as Record<string, string>)[metric[1].toLowerCase()];
    if (m.includes('ageing')) {
      const row = metric[2] ? Number(metric[2]) - 1 : 0;
      const field = m.includes('department') ? 'department' : m.includes('bucket') ? 'bucket' : 'count';
      return `metrics.${key}.ageing.${row}.${field}`;
    }
    return `metrics.${key}.${m.includes('closed') ? 'closed' : 'issued'}`;
  }
  if (m.startsWith('material:')) {
    const fields: [string, string][] = [['closed', 'closed'], ['issued', 'issued'], ['osd available', 'osdAvailable'], ['mirns with osd', 'osdMirns'], ['overage', 'overage'], ['shortage', 'shortage'], ['damage', 'damage'], ['defective', 'defective'], ['total no.', 'totalItems'], ['status tags total', 'totalItems'],
      ...['approved', 'onHold', 'rejectedDoNotUse', 'rejectedReturn', 'hazardous', 'handleWithCare'].map(key => [key.toLowerCase(), key] as [string, string])];
    return `material.${fields.find(([label]) => m.includes(label))?.[1] ?? 'issued'}`;
  }
  if (m.startsWith('qtbt:') || m.startsWith('training:')) {
    const training = m.startsWith('training:');
    return `${training ? 'training' : 'qtbt'}.${m.includes('attendee') ? 'attendance' : m.includes('duration') ? 'durationMinutes' : training ? 'trainingCount' : 'talkCount'}`;
  }
  const documents = /^(drawings|submittals):/i.exec(message);
  if (documents) {
    const field = m.includes('client review') ? 'clientReviewDays' : m.includes('algihaz') ? 'internalReviewDays' : m.includes('re-submitted') ? 'resubmitted' : m.includes('rejected') ? 'rejected' : m.includes('under review') ? 'underReview' : 'approved';
    return `documents.${documents[1].toLowerCase()}.${field}`;
  }
  const qms = /^qms report(?: (\d+))?/i.exec(message);
  if (qms) return qms[1] ? `qmsReports.${Number(qms[1]) - 1}.${m.includes('department') ? 'department' : m.includes('type') ? 'type' : 'status'}` : 'qmsReports';
  return undefined;
}

/** Reveal a collapsed tile, then scroll/focus without changing data or unlocking controls. */
export function jumpToMonthlyIssue(root: HTMLElement, path: string): boolean {
  const fields = Array.from(root.querySelectorAll<HTMLElement>('[data-report-field]'));
  let target: HTMLElement | undefined;
  for (let key = path; key && !target; key = key.includes('.') ? key.slice(0, key.lastIndexOf('.')) : '') {
    target = fields.find(element => element.dataset.reportField === key);
  }
  if (!target) return false;
  const tile = target.closest('[data-report-tile]');
  tile?.querySelector<HTMLButtonElement>('[data-report-tile-toggle][aria-expanded="false"]')?.click();
  const destination = target;
  requestAnimationFrame(() => {
    destination.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const control = destination.matches('input,textarea,select,button')
      ? destination : destination.querySelector<HTMLElement>('input:not(:disabled),textarea:not(:disabled),select:not(:disabled),button:not(:disabled)');
    if (control && !control.matches(':disabled')) control.focus({ preventScroll: true });
    else {
      const container = destination.matches(':disabled') ? destination.parentElement ?? destination : destination;
      container.tabIndex = -1;
      container.focus({ preventScroll: true });
    }
  });
  return true;
}
