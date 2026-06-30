import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { getToken, getUser, setSession, clearSession, onAuthChange } from '../lib/auth.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => (getToken() ? getUser() : null));
  const [loading, setLoading] = useState(() => !!getToken());

  useEffect(() => {
    if (!getToken()) { setLoading(false); return; }
    api.me()
      .then((r) => setUser(r.user))
      .catch(() => clearSession())
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    return onAuthChange(() => {
      setUser(getToken() ? getUser() : null);
    });
  }, []);

  const login = async (username, password) => {
    const r = await api.login(username, password);
    setSession({ token: r.token, user: r.user });
    setUser(r.user);
    return r.user;
  };

  const logout = () => { clearSession(); };

  return (
    <AuthCtx.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
