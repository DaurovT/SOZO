import { clearSession, getToken } from './auth';

const BASE_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/v1';

/** База API — нужна для ссылок, которые открывает сам браузер (фото, печатные документы). */
export const API_BASE = BASE_URL;

/**
 * Ссылки, по которым ходит браузер (<img>, новая вкладка), не могут нести заголовок
 * Authorization — токен передаётся query-параметром (dev-аналог signed URL, PRD-05 §9).
 */
function withToken(path: string): string {
  return `${API_BASE}${path}?token=${encodeURIComponent(getToken() ?? '')}`;
}

/** URL оригинала фото заявки; без токена сервер отвечает 401. */
export function photoUrl(file: string): string {
  return withToken(`/photos/${encodeURIComponent(file)}`);
}

/** URL печатного акта выполненных работ (HTML → Cmd+P → PDF). */
export function orderActUrl(orderId: string): string {
  return withToken(`/documents/orders/${encodeURIComponent(orderId)}/act`);
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public failedGuard?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(BASE_URL + path, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError('Нет связи с сервером — проверьте, что API запущен', 0);
  }

  if (res.status === 401) {
    clearSession();
    if (!window.location.pathname.startsWith('/login')) {
      window.location.assign('/login');
    }
    throw new ApiError('Требуется вход', 401, 'UNAUTHORIZED');
  }

  if (!res.ok) {
    let message = `Ошибка запроса (${res.status})`;
    let code: string | undefined;
    let failedGuard: string | undefined;
    try {
      const data = await res.json();
      code = data?.code ?? data?.error?.code;
      failedGuard = data?.failedGuard;
      const m = data?.message ?? data?.error?.message;
      if (typeof m === 'string') message = m;
      else if (Array.isArray(m)) message = m.join('; ');
      else if (code) message = String(code);
    } catch {
      /* тело не JSON — оставляем сообщение по умолчанию */
    }
    throw new ApiError(message, res.status, code, failedGuard);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
