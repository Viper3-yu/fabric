import type { AuthSession } from '../types';

const SESSION_KEY = 'jixin.auth.session';

function decodeTokenExpiry(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as {
      exp?: unknown;
    };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

export function readSession(): AuthSession | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<AuthSession>;
    if (!value.token || !value.user || !value.ledgerMode) return null;
    const expiry = decodeTokenExpiry(value.token);
    if (expiry !== null && expiry * 1000 <= Date.now()) {
      clearSession();
      return null;
    }
    return value as AuthSession;
  } catch {
    return null;
  }
}

export function writeSession(session: AuthSession): void {
  // A full or blocked localStorage must not break an in-memory login.
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* ignore: session lives only for this page view */
  }
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function getToken(): string | null {
  return readSession()?.token ?? null;
}
