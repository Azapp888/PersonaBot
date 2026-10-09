import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, clearToken, getToken, setToken } from "@/lib/api";

interface AuthState {
  username: string | null;
  ready: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  username: null,
  ready: false,
  login: async () => undefined,
  logout: async () => undefined,
});

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [username, setUsername] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const onUnauthorized = () => setUsername(null);
    window.addEventListener("pb:unauthorized", onUnauthorized);
    (async () => {
      if (!getToken()) {
        setReady(true);
        return;
      }
      try {
        const me = await api.me();
        setUsername(me.username);
      } catch {
        clearToken();
      } finally {
        setReady(true);
      }
    })();
    return () => window.removeEventListener("pb:unauthorized", onUnauthorized);
  }, []);

  const login = async (u: string, p: string) => {
    const res = await api.login(u, p);
    setToken(res.token);
    setUsername(res.username);
  };

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    clearToken();
    setUsername(null);
  };

  return <AuthContext.Provider value={{ username, ready, login, logout }}>{children}</AuthContext.Provider>;
}
