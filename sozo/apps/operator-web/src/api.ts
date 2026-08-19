import { clearSession, getToken } from './auth';

const BASE_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/v1';
export const API_BASE = BASE_URL;

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
  method?: 'GET' | 'POST';
  body?: unknown;
}

/**
 * Единая точка запросов. Ошибку API разворачиваем до кода и текста:
 * у контура «Дом» коды несут смысл для пользователя — например
 * CommonAreaIsOperatorOnly объясняет, почему заявка не уходит наружу.
 */
export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });

  if (res.status === 401) {
    clearSession();
    window.location.reload();
    throw new ApiError('Сессия истекла', 401);
  }

  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : {};

  if (!res.ok) {
    const d = data as { message?: unknown; error?: string };
    const m = d.message;
    const message =
      typeof m === 'string'
        ? m
        : m && typeof m === 'object' && 'message' in m
          ? String((m as { message: unknown }).message)
          : (d.error ?? 'Ошибка запроса');
    const code =
      m && typeof m === 'object' && 'code' in m ? String((m as { code: unknown }).code) : undefined;
    throw new ApiError(message, res.status, code);
  }
  return data as T;
}
