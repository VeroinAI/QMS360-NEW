/** Display-only historical data and broad offline snapshots never authorize a selection. */
export function eligibleParticipantOptions<T>(data: { users: T[] } | undefined, online: boolean, failed: boolean): T[] {
  return online && !failed ? data?.users ?? [] : [];
}
