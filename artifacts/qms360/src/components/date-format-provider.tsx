import { useLayoutEffect, type ReactNode } from 'react';
import { useGetPlatformDateFormat, getGetPlatformDateFormatQueryKey } from '@workspace/api-client-react';
import { setDateFormatResolver, type DateFormat } from '@workspace/spreadsheet-dates';
import { Button } from '@/components/ui/button';

export const dateFormatQueryKey = (userId: string, organization: string) => [...getGetPlatformDateFormatQueryKey(), userId, organization] as const;

/**
 * Loads the organization date format for the signed-in user and installs it as
 * the shared resolver. Children are withheld until the format for THIS
 * organization has loaded, so nothing renders or imports with a stale format.
 */
export function DateFormatProvider({ userId, organization, children }: { userId: string; organization: string; children: ReactNode }) {
  const query = useGetPlatformDateFormat({ query: {
    queryKey: dateFormatQueryKey(userId, organization), staleTime: 30_000, refetchOnWindowFocus: 'always', refetchInterval: 60_000, retry: 1,
  } });
  const format = query.data?.dateFormat;
  // Resolver is bound to this user/organization identity; cleared on switch or unmount.
  const identity = `${userId}:${organization}`;
  setDateFormatResolver(() => (format ?? 'DD/MM/YYYY') as DateFormat);
  useLayoutEffect(() => {
    setDateFormatResolver(() => (format ?? 'DD/MM/YYYY') as DateFormat);
    return () => { setDateFormatResolver(() => 'DD/MM/YYYY'); };
  }, [identity, format]);
  if (!format && query.isError) {
    return <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background p-6 text-center" role="alert">
      <p className="text-sm text-destructive">The organization date format could not be loaded.</p>
      <Button variant="outline" onClick={() => void query.refetch()}>Retry</Button>
    </div>;
  }
  if (!format) return <div className="flex min-h-dvh items-center justify-center bg-background"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  // Keyed only by identity: a format change must not discard unsaved forms.
  return <div key={identity} className="contents">{children}</div>;
}
