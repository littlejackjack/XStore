'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { endpoints, getAccessToken, setAccessToken, type User } from './api';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      setLoading(false);
      return;
    }
    endpoints
      .me()
      .then((payload) => setUser(payload.user))
      .catch(() => setAccessToken(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const payload = await endpoints.login(email, password);
    setAccessToken(payload.accessToken);
    setUser(payload.user);
  }, []);

  const register = useCallback(async (email: string, password: string, name: string) => {
    const payload = await endpoints.register(email, password, name);
    setAccessToken(payload.accessToken);
    setUser(payload.user);
  }, []);

  const logout = useCallback(async () => {
    await endpoints.logout().catch(() => undefined);
    setAccessToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
