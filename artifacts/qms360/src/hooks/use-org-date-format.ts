import { useGetCurrentUser, useGetPlatformDateFormat } from '@workspace/api-client-react';
import { dateFormatQueryKey } from '@/components/date-format-provider';

export function useOrgDateFormat() {
  const user = useGetCurrentUser();
  const org = user.data?.organizationName ?? '';
  const query = useGetPlatformDateFormat({ query: { queryKey: dateFormatQueryKey(user.data?.id ?? '', org), enabled: Boolean(user.data), refetchOnWindowFocus: 'always' } });
  return { format: query.data?.dateFormat, query };
}
