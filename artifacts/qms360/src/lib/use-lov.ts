import { useGetMasterDataLov } from '@workspace/api-client-react';

export function useLov(code: string) {
  const query = useGetMasterDataLov(code);
  return {
    options: query.data?.values.map(({ value, label }) => ({ value, label })) ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
}

export function withLegacyOption(options: { value: string; label: string }[], value?: string) {
  return value && !options.some(option => option.value === value)
    ? [{ value, label: value }, ...options]
    : options;
}