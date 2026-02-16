import { createContext, useContext, useState, ReactNode, useEffect, useCallback } from "react";
import type { LoginUser } from "@/services/authService";
import { getCurrentUserMe, type CurrentUserMe } from "@/services/userService";

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
    const storedToken = localStorage.getItem("vca_token");
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
    if (storedToken) {
      setToken(storedToken);
    }
    setInitializing(false);
  }, []);

  useEffect(() => {
    if (!token) {
      setMe(null);
      return;
    }
    getCurrentUserMe()
      .then(setMe)
      .catch(() => setMe(null));
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

  /** True only if this permission is actually assigned to the user's role (no auto-grant for Admin). */
  const hasPermission = useCallback(
    (codename: string) => {
      if (!me) return false;
      return me.permissions?.some((p) => p.codename === codename) ?? false;
    },
    [me]
  );

  const isAdmin = useCallback(
    () => (me?.role?.name?.toLowerCase() === "admin" ?? false),
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

