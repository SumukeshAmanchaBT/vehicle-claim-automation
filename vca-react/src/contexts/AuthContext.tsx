import { createContext, useContext, useState, ReactNode, useEffect } from "react";
import type { LoginUser } from "@/services/authService";

interface AuthContextValue {
  user: LoginUser | null;
  token: string | null;
  initializing: boolean;
  login: (user: LoginUser, token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<LoginUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
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

  const login = (nextUser: LoginUser, nextToken: string) => {
    setUser(nextUser);
    setToken(nextToken);
    localStorage.setItem("vca_user", JSON.stringify(nextUser));
    localStorage.setItem("vca_token", nextToken);
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem("vca_user");
    localStorage.removeItem("vca_token");
  };

  return (
    <AuthContext.Provider value={{ user, token, initializing, login, logout }}>
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

