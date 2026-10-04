import { useCallback, useMemo } from 'react';
import { useGetQaqcCapabilities } from '@workspace/api-client-react';
import { qaqcPermissionMatches, type QaqcOperation } from '@workspace/field-controls';

const adminTasks: QaqcOperation[] = ['configure_masters', 'manage_ai_settings', 'delegate', 'manage_roles', 'manage_access', 'view_audit_log'];

// Fails closed: until the server answers (or on error) nothing is permitted.
export function useQaqcCapabilities(enabled = true) {
  const q = useGetQaqcCapabilities({ query: { refetchInterval: 30_000, refetchOnWindowFocus: true, refetchOnMount: 'always', enabled } } as never) as { data?: { keys?: string[]; administrator?: boolean }; isLoading: boolean };
  const keys = useMemo(() => q.data?.keys ?? [], [q.data]);
  const administrator = q.data?.administrator === true;
  const can = useCallback((module: string, operation: QaqcOperation) =>
    administrator || keys.some(k => qaqcPermissionMatches(k, module, operation)), [keys, administrator]);
  const canAnyRead = useCallback((module: string) => can(module, 'view_own_scope') || can(module, 'view_all'), [can]);
  const canTask = useCallback((task: QaqcOperation) => administrator || keys.some(k => k.toLowerCase() === `qaqc.${task}` || (task === 'manage_ai_settings' && k.toLowerCase() === 'manage_ai_settings') || (task !== 'manage_ai_settings' && k.toLowerCase() === task)), [keys, administrator]);
  const hasAdminTasks = administrator || adminTasks.some(canTask);
  return { can, canAnyRead, canTask, hasAdminTasks, administrator, isLoading: q.isLoading };
}
