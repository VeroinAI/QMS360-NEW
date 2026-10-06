/** Drona's API returns sanitized error text. Read only that field, never render
 * arbitrary SDK profiles, raw response bodies or serialized error objects. */
export function dronaSignInError(cause: unknown): string {
  const remote = cause && typeof cause === 'object'
    ? cause as { status?: unknown; data?: unknown } : undefined;
  if (typeof remote?.status === 'number') {
    const data = remote.data;
    const message = data && typeof data === 'object' && 'error' in data ? data.error : undefined;
    if (typeof message === 'string' && message.trim() && message.length <= 512) return message;
    return remote.status === 503
      ? 'Drona sign-in is temporarily unavailable. Retry or contact your administrator.'
      : 'Drona sign-in could not be completed. Contact your administrator.';
  }
  return cause instanceof Error ? cause.message : 'Drona sign-in could not be completed.';
}
