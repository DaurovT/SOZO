import { clearSession, getToken } from './auth';

/** База API — нужна и для fetch, и для печатных документов (открываются прямой ссылкой). */
export const API_BASE: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/v1';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
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
    res = await fetch(API_BASE + path, {
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
    try {
      const data = await res.json();
      code = data?.code ?? data?.error?.code;
      const m = data?.message ?? data?.error?.message;
      if (typeof m === 'string') message = m;
      else if (Array.isArray(m)) message = m.join('; ');
      else if (code) message = String(code);
    } catch {
      /* тело не JSON — оставляем сообщение по умолчанию */
    }
    throw new ApiError(message, res.status, code);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Печатные документы отдаются сервером как HTML для печати в PDF (Ctrl+P → «Сохранить как PDF»).
 * Открываем в новой вкладке; токен — в query, обычная ссылка не умеет слать заголовок Authorization.
 */
export function openDocument(path: string): void {
  window.open(`${API_BASE}${path}?token=${encodeURIComponent(getToken() ?? '')}`, '_blank');
}

/**
 * URL фото заявки для <img>. Браузер ходит по такой ссылке сам и не умеет слать
 * заголовок Authorization — токен передаётся query-параметром, как и в печатных
 * документах (dev-аналог signed URL, PRD-05 §9).
 */
export function photoUrl(file: string): string {
  return `${API_BASE}/photos/${encodeURIComponent(file)}?token=${encodeURIComponent(getToken() ?? '')}`;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
