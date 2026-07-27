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
import { clearSession, readSession, writeSession } from '../lib/storage';
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
  const saved = useMemo(() => readSession(), []);
  const [user, setUser] = useState<AppUser | null>(saved?.user ?? null);
  const [ledgerMode, setLedgerMode] = useState<LedgerMode | null>(saved?.ledgerMode ?? null);
  const [ready, setReady] = useState(!saved);

  const logout = useCallback(() => {
    clearSession();
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
    if (!saved) return;
    let active = true;
    api.auth
      .me()
      .then(({ data, meta }) => {
        if (!active) return;
        const nextUser = 'user' in data ? data.user : data;
        const nextMode =
          ('user' in data ? data.ledgerMode : undefined) ?? meta?.ledgerMode ?? saved.ledgerMode;
        const session = { token: saved.token, user: nextUser, ledgerMode: nextMode };
        writeSession(session);
        setUser(nextUser);
        setLedgerMode(nextMode);
      })
      .catch(() => {
        if (active) logout();
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [logout, saved]);

  const login = useCallback(async (username: string, password: string) => {
    const { data } = await api.auth.login(username, password);
    writeSession(data);
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
