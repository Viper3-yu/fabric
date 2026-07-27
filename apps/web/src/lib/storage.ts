import type { AuthSession } from '../types';

const SESSION_KEY = 'jixin.auth.session';

export function readSession(): AuthSession | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<AuthSession>;
    if (!value.token || !value.user || !value.ledgerMode) return null;
    return value as AuthSession;
  } catch {
    return null;
  }
}

export function writeSession(session: AuthSession): void {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  window.localStorage.removeItem(SESSION_KEY);
}

export function getToken(): string | null {
  return readSession()?.token ?? null;
}
