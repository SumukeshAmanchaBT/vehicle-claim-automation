import { createContext, useContext, useState, ReactNode, useEffect } from "react";

interface User {
  username: string;
}

interface AuthContextValue {
  user: User | null;
  login: (username: string, token?: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const storedUser = localStorage.getItem("vca_user");
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
  }, []);

  const login = (username: string, token?: string) => {
    const nextUser = { username };
    setUser(nextUser);
    localStorage.setItem("vca_user", JSON.stringify(nextUser));
    if (token) {
      localStorage.setItem("vca_token", token);
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem("vca_user");
    localStorage.removeItem("vca_token");
  };

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
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

