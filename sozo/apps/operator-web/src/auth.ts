import type { AuthUser } from './types';

const TOKEN_KEY = 'sozo_operator_token';
const USER_KEY = 'sozo_operator_user';
const ORG_KEY = 'sozo_operator_org';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

/**
 * Организация-оператор, в контексте которой работает пользователь.
 * Хранится отдельно от пользователя: один человек может обслуживать
 * несколько организаций (DEV-15 §10.9.5).
 */
export function getOrgId(): string | null {
  return localStorage.getItem(ORG_KEY);
}

export function setSession(token: string, user: AuthUser, orgId: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  localStorage.setItem(ORG_KEY, orgId);
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(ORG_KEY);
}
