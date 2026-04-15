import { useState } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import axios from "axios";
import { useAuth } from "@/contexts/AuthContext";
import { loginApi } from "@/services/authService";
import { API_BASE_URL } from "@/lib/httpClient";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Lock, Mail } from "lucide-react";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as any;
  const from = location.state?.from?.pathname || "/";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (!username || !password) {
        throw new Error("Username and password are required");
      }

      if (!API_BASE_URL) {
        throw new Error(
          "API URL is not configured (VITE_API_BASE_URL). Add vca-react/.env and restart the dev server."
        );
      }

      const result = await loginApi({ username, password });
      login(result.user, result.token);
      navigate(from, { replace: true });
    } catch (err: unknown) {
      let message = "Login failed. Please check your credentials.";
      if (axios.isAxiosError(err)) {
        const data = err.response?.data as
          | { detail?: string; error?: string; message?: string }
          | undefined;
        const fromBody =
          (typeof data?.detail === "string" && data.detail) ||
          (typeof data?.error === "string" && data.error) ||
          (typeof data?.message === "string" && data.message) ||
          "";

        if (err.code === "ECONNABORTED") {
          message = `Request timed out after ${err.config?.timeout ?? "?"}ms. Is the backend running and reachable at ${API_BASE_URL}?`;
        } else if (!err.response) {
          message = `Cannot reach the API (${API_BASE_URL}). Start Django from the vca-python folder (python manage.py runserver), confirm this URL matches your backend, and check the browser console—if you see a CORS error about a request header, the API must allow that header in CORS_ALLOW_HEADERS.`;
        } else if (fromBody) {
          message = fromBody;
        } else if (err.response.status === 401) {
          message = "Invalid username or password.";
        }
      } else if (err instanceof Error) {
        message = err.message;
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="w-full max-w-md px-4">
        <Card className="border-slate-800 bg-slate-900/80 backdrop-blur-md shadow-2xl">
          <CardHeader className="space-y-2">
            <CardTitle className="text-2xl font-semibold text-slate-50">
              ClaimFlow AI
            </CardTitle>
            <CardDescription className="text-slate-300">
              Sign in to access the vehicle claims automation console.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="username" className="text-slate-100">
                  Username
                </Label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
                    <Mail className="h-4 w-4" />
                  </span>
                  <Input
                    id="username"
                    type="text"
                    autoComplete="username"
                    className="pl-9 bg-slate-950/60 border-slate-700 text-slate-50 placeholder:text-slate-500"
                    placeholder="Enter your username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-slate-100">
                  Password
                </Label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
                    <Lock className="h-4 w-4" />
                  </span>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    className="pl-9 bg-slate-950/60 border-slate-700 text-slate-50 placeholder:text-slate-500"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>

              {error && (
                <p className="text-sm text-red-400 bg-red-950/40 border border-red-900 rounded px-3 py-2">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                className="w-full mt-2"
                disabled={loading}
              >
                {loading ? "Signing in..." : "Sign in"}
              </Button>

              <div className="flex items-center justify-between text-xs text-slate-300 mt-2">
                <Link
                  to="/forgot-password"
                  className="hover:text-slate-50 underline-offset-2 hover:underline"
                >
                  Forgot password?
                </Link>
                <Link
                  to="/change-password"
                  className="hover:text-slate-50 underline-offset-2 hover:underline"
                >
                  Change password
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

