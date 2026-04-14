import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

export function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, token, initializing } = useAuth();
  const location = useLocation();

  // Wait for auth state to hydrate from localStorage
  if (initializing) {
    return null;
  }

  // Both are required: stale vca_user without vca_token caused dashboard 401s on every API call.
  if (!user || !token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}

