import { useGetMasterDataLov } from '@workspace/api-client-react';

export function useLov(code: string) {
  const query = useGetMasterDataLov(code);
  return {
    options: query.data?.values.map(({ value, label, metadata }) => ({ value, label, metadata })) ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

export function withLegacyOption(options: { value: string; label: string }[], value?: string) {
  return value && !options.some(option => option.value === value)
    ? [{ value, label: value }, ...options]
    : options;
}