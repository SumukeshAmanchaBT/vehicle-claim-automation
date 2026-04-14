import { createContext, useContext, useState, ReactNode, useEffect, useCallback } from "react";
import axios from "axios";
import type { LoginUser } from "@/services/authService";
import { getCurrentUserMe, type CurrentUserMe } from "@/services/userService";
import { VCA_SESSION_EXPIRED_EVENT } from "@/lib/authEvents";

interface AuthContextValue {
  user: LoginUser | null;
  token: string | null;
  /** Current user with role and permissions (for permission-based UI). */
  me: CurrentUserMe | null;
  initializing: boolean;
  login: (user: LoginUser, token: string) => void;
  logout: () => void;
  /** True if user has the given permission codename (e.g. "users.view") or is admin. */
  hasPermission: (codename: string) => boolean;
  /** True if user is admin (role name or staff). */
  isAdmin: () => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<LoginUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<CurrentUserMe | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    const storedUser = localStorage.getItem("vca_user");
    let storedToken = localStorage.getItem("vca_token");
    if (storedUser && !storedToken) {
      localStorage.removeItem("vca_user");
    }
    if (storedToken && !localStorage.getItem("vca_user")) {
      localStorage.removeItem("vca_token");
      storedToken = null;
    }
    const u = localStorage.getItem("vca_user");
    const t = localStorage.getItem("vca_token");
    if (u) {
      try {
        setUser(JSON.parse(u));
      } catch {
        localStorage.removeItem("vca_user");
      }
    }
    if (t) setToken(t);
    setInitializing(false);
  }, []);

  useEffect(() => {
    const onExpired = () => {
      setUser(null);
      setToken(null);
      setMe(null);
    };
    window.addEventListener(VCA_SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(VCA_SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  useEffect(() => {
    if (!token) {
      setMe(null);
      return;
    }
    getCurrentUserMe()
      .then(setMe)
      .catch((err) => {
        setMe(null);
        if (axios.isAxiosError(err) && err.response?.status === 401) {
          setUser(null);
          setToken(null);
          localStorage.removeItem("vca_user");
          localStorage.removeItem("vca_token");
        }
      });
  }, [token]);

  const login = (nextUser: LoginUser, nextToken: string) => {
    setUser(nextUser);
    setToken(nextToken);
    localStorage.setItem("vca_user", JSON.stringify(nextUser));
    localStorage.setItem("vca_token", nextToken);
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    setMe(null);
    localStorage.removeItem("vca_user");
    localStorage.removeItem("vca_token");
  };

  /** Matches backend core.permissions: admin users bypass permission list; others need role permission. */
  const isAdmin = useCallback(() => {
    if (!me) return false;
    if (me.is_staff || me.is_superuser) return true;
    return me.role?.name?.toLowerCase() === "admin";
  }, [me]);

  const hasPermission = useCallback(
    (codename: string) => {
      if (!me) return false;
      if (me.is_staff || me.is_superuser || me.role?.name?.toLowerCase() === "admin") return true;
      return me.permissions?.some((p) => p.codename === codename) ?? false;
    },
    [me]
  );

  return (
    <AuthContext.Provider
      value={{ user, token, me, initializing, login, logout, hasPermission, isAdmin }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}

