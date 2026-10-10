import { API_BASE_URL } from './deployment';

let accountEpoch = 0;

export function invalidateAccountRequests(): void {
  accountEpoch += 1;
}

const REQUEST_TIMEOUT_MS = 15_000;
// Base64 image uploads can be several megabytes on slow mobile uplinks.
const MEDIA_UPLOAD_TIMEOUT_MS = 120_000;

export function requestTimeoutMs(path: string, method: string): number {
  return method === 'POST' && path === '/api/media' ? MEDIA_UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
}

export type ApiResult<T extends object = object> =
  | ({ success: true } & T)
  | { success: false; error: string; status: number };

export async function apiRequest<T extends object = object>(
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
  body?: object,
): Promise<ApiResult<T>> {
  const requestEpoch = accountEpoch;
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      credentials: 'include',
      headers: method !== 'GET' ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : method === 'GET' ? undefined : '{}',
      signal: AbortSignal.timeout(requestTimeoutMs(path, method)),
    });
    const result = await response.json() as { success?: boolean; error?: string };
    if (!response.ok || !result.success) {
      if (requestEpoch === accountEpoch && response.status === 401 &&
        path !== '/api/auth/login' && path !== '/api/auth/password' && path !== '/api/auth/me') {
        window.dispatchEvent(new Event('account:expired'));
      }
      return { success: false, error: result.error ?? 'Request failed.', status: response.status };
    }
    return result as ApiResult<T>;
  } catch {
    return { success: false, error: 'Unable to reach the server. Please try again.', status: 0 };
  }
}
