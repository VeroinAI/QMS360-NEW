/** Metrics documents are editable only in Draft; other report workflows retain their own rules. */
export function canEditMetricsDocument(state: string | undefined, permitted: boolean, displayOnly = false) {
  return state === 'draft' && permitted && !displayOnly;
}

export function metricsDocumentHref(id: string, state: string, permitted: boolean) {
  const path = `/qaqc/metrics/reports/${id}`;
  return canEditMetricsDocument(state, permitted) ? path : `${path}?mode=view`;
}

/** Submission stays with the creator; the server additionally enforces project scope. */
export function canSubmitMetricsDocument(state: string | undefined, permitted: boolean, creatorId?: string | null, userId?: string) {
  return state === 'draft' && permitted && !!userId && creatorId === userId;
}
