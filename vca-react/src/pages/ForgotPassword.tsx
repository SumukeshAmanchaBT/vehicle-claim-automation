import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Mail } from "lucide-react";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: call backend forgot-password endpoint
    if (email) {
      setSubmitted(true);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="w-full max-w-md px-4">
        <Card className="border-slate-800 bg-slate-900/80 backdrop-blur-md shadow-2xl">
          <CardHeader className="space-y-2">
            <CardTitle className="text-2xl font-semibold text-slate-50">
              Forgot password
            </CardTitle>
            <CardDescription className="text-slate-300">
              Enter your work email and we&apos;ll send you reset instructions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="email" className="text-slate-100">
                  Work Email
                </Label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
                    <Mail className="h-4 w-4" />
                  </span>
                  <Input
                    id="email"
                    type="email"
                    className="pl-9 bg-slate-950/60 border-slate-700 text-slate-50 placeholder:text-slate-500"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>

              {submitted && (
                <p className="text-sm text-emerald-300 bg-emerald-950/40 border border-emerald-900 rounded px-3 py-2">
                  If an account exists for this email, you&apos;ll receive a reset link shortly.
                </p>
              )}

              <Button type="submit" className="w-full mt-2">
                Send reset link
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

