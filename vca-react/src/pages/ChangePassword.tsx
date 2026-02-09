import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Lock } from "lucide-react";

export default function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!next || !confirm) {
      setError("New password and confirmation are required.");
      return;
    }
    if (next !== confirm) {
      setError("New password and confirmation do not match.");
      return;
    }

    // TODO: call backend change-password endpoint
    setSuccess(true);
    setCurrent("");
    setNext("");
    setConfirm("");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="w-full max-w-md px-4">
        <Card className="border-slate-800 bg-slate-900/80 backdrop-blur-md shadow-2xl">
          <CardHeader className="space-y-2">
            <CardTitle className="text-2xl font-semibold text-slate-50">
              Change password
            </CardTitle>
            <CardDescription className="text-slate-300">
              Update your account password to keep your access secure.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="current" className="text-slate-100">
                  Current password
                </Label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
                    <Lock className="h-4 w-4" />
                  </span>
                  <Input
                    id="current"
                    type="password"
                    autoComplete="current-password"
                    className="pl-9 bg-slate-950/60 border-slate-700 text-slate-50 placeholder:text-slate-500"
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="new" className="text-slate-100">
                  New password
                </Label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
                    <Lock className="h-4 w-4" />
                  </span>
                  <Input
                    id="new"
                    type="password"
                    autoComplete="new-password"
                    className="pl-9 bg-slate-950/60 border-slate-700 text-slate-50 placeholder:text-slate-500"
                    value={next}
                    onChange={(e) => setNext(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm" className="text-slate-100">
                  Confirm new password
                </Label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
                    <Lock className="h-4 w-4" />
                  </span>
                  <Input
                    id="confirm"
                    type="password"
                    autoComplete="new-password"
                    className="pl-9 bg-slate-950/60 border-slate-700 text-slate-50 placeholder:text-slate-500"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </div>
              </div>

              {error && (
                <p className="text-sm text-red-400 bg-red-950/40 border border-red-900 rounded px-3 py-2">
                  {error}
                </p>
              )}
              {success && (
                <p className="text-sm text-emerald-300 bg-emerald-950/40 border border-emerald-900 rounded px-3 py-2">
                  Your password has been updated.
                </p>
              )}

              <Button type="submit" className="w-full mt-2">
                Update password
              </Button>

              <div className="flex justify-between text-xs text-slate-300 mt-2">
                <Link
                  to="/login"
                  className="hover:text-slate-50 underline-offset-2 hover:underline"
                >
                  Back to login
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

