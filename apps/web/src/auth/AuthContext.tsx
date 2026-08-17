import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AppUser } from '@jixin/shared';
import { api } from '../lib/api';
import type { LedgerMode } from '../types';

interface AuthContextValue {
  user: AppUser | null;
  ledgerMode: LedgerMode | null;
  ready: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [ledgerMode, setLedgerMode] = useState<LedgerMode | null>(null);
  const [ready, setReady] = useState(false);

  const logout = useCallback(() => {
    // Best-effort server-side cookie clear; the JWT itself stays stateless.
    void api.auth.logout().catch(() => undefined);
    setUser(null);
    setLedgerMode(null);
    setReady(true);
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => logout();
    window.addEventListener('jixin:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('jixin:unauthorized', handleUnauthorized);
  }, [logout]);

  useEffect(() => {
    // The session lives in the httpOnly cookie; /auth/me validates it and
    // returns the current user, so a page refresh restores the session
    // without ever touching localStorage.
    let active = true;
    api.auth
      .me()
      .then(({ data, meta }) => {
        if (!active) return;
        const nextUser = 'user' in data ? data.user : data;
        const nextMode = ('user' in data ? data.ledgerMode : undefined) ?? meta?.ledgerMode ?? null;
        setUser(nextUser);
        setLedgerMode(nextMode);
      })
      .catch(() => {
        // No cookie, expired token, or API unreachable: stay signed out.
        if (active) {
          setUser(null);
          setLedgerMode(null);
        }
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const { data } = await api.auth.login(username, password);
    // The browser stores the httpOnly cookie; only the user data is kept in
    // memory for this page view.
    setUser(data.user);
    setLedgerMode(data.ledgerMode);
    setReady(true);
  }, []);

  const value = useMemo(
    () => ({ user, ledgerMode, ready, login, logout }),
    [user, ledgerMode, ready, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return context;
}
