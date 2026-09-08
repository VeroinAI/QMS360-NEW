export type UserFacingError = {
  title: string;
  message: string;
  technicalCode: string;
};

type ApiErrorShape = {
  status?: number;
  data?: unknown;
  message?: string;
};

function responseMessage(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const record = data as Record<string, unknown>;
  for (const key of ['error', 'message', 'detail']) {
    if (typeof record[key] === 'string' && record[key].trim()) return record[key].trim();
  }
  return undefined;
}

export function userFacingApiError(error: unknown, fallback = 'The request could not be completed.'): UserFacingError {
  const apiError = error as ApiErrorShape;
  const status = typeof apiError?.status === 'number' ? apiError.status : undefined;
  const serverMessage = responseMessage(apiError?.data);

  if (!status) {
    return {
      title: 'Connection problem',
      message: 'QMS360 could not reach the server. Check your connection and try again.',
      technicalCode: 'NETWORK',
    };
  }
  if (status === 401) return { title: 'Authentication failed', message: serverMessage ?? 'Your session or credentials were not accepted.', technicalCode: 'HTTP 401' };
  if (status === 403) return { title: 'Access denied', message: serverMessage ?? 'Your account does not have permission for this action.', technicalCode: 'HTTP 403' };
  if (status === 404) return { title: 'Not found', message: serverMessage ?? 'The requested record could not be found.', technicalCode: 'HTTP 404' };
  if (status === 409) return { title: 'Conflicting change', message: serverMessage ?? 'This record changed or already exists. Refresh and try again.', technicalCode: 'HTTP 409' };
  if (status === 400 || status === 422) return { title: 'Check the entered information', message: serverMessage ?? fallback, technicalCode: `HTTP ${status}` };
  if (status >= 500) {
    return {
      title: 'QMS360 service error',
      message: 'The server could not complete the request. Your entered information was not necessarily incorrect.',
      technicalCode: `HTTP ${status}`,
    };
  }
  return { title: 'Request failed', message: serverMessage ?? fallback, technicalCode: `HTTP ${status}` };
}