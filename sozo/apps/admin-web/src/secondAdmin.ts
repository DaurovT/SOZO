import { api, ApiError } from './api';

/**
 * Паттерн двойного подтверждения (SECOND_ADMIN_REQUIRED, PRD-04 §1.3):
 * сначала POST без флага; при 400 SECOND_ADMIN_REQUIRED — confirm и повтор с флагом.
 * Возвращает null, если пользователь отказался от подтверждения.
 */
export async function postWithSecondAdmin<T = unknown>(
  path: string,
  body: Record<string, unknown>,
  confirmText: string,
): Promise<T | null> {
  try {
    return await api.post<T>(path, body);
  } catch (e) {
    if (e instanceof ApiError && e.code === 'SECOND_ADMIN_REQUIRED') {
      if (!window.confirm(confirmText)) return null;
      return await api.post<T>(path, { ...body, secondAdminConfirmed: true });
    }
    throw e;
  }
}
