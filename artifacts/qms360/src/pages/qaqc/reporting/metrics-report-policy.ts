/** Draft and sent-back Metrics documents allow authorized corrections. */
export function canEditMetricsDocument(state: string | undefined, permitted: boolean, displayOnly = false) {
  return (state === 'draft' || state === 'sent_back') && permitted && !displayOnly;
}

export function metricsDocumentHref(id: string, state: string, permitted: boolean) {
  const path = `/qaqc/metrics/reports/${id}`;
  return canEditMetricsDocument(state, permitted) ? path : `${path}?mode=view`;
}

/** Submission is role-based; the server additionally enforces the submit role's project scope. */
export function canSubmitMetricsDocument(state: string | undefined, permitted: boolean, userId?: string) {
  return (state === 'draft' || state === 'sent_back') && permitted && !!userId;
}
