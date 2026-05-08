"use client";

import { Suspense, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

type View = "login" | "reset" | "magic_sent" | "reset_sent";

function LoginForm() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlError = searchParams.get("error");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<View>("login");

  async function handleGoogle() {
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) { setError(error.message); setLoading(false); }
  }

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    else router.replace("/dashboard");
    setLoading(false);
  }

  async function handleMagicLink() {
    if (!email) { setError("Enter your email first."); return; }
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({ email });
    if (error) setError(error.message);
    else setView("magic_sent");
    setLoading(false);
  }

  async function handleResetPassword() {
    if (!email) { setError("Enter your email first."); return; }
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
    });
    if (error) setError(error.message);
    else setView("reset_sent");
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#070b12] relative overflow-hidden px-4">
      <div className="absolute inset-0 dot-grid opacity-70 pointer-events-none" />
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] pointer-events-none"
        style={{ background: "radial-gradient(ellipse at top, rgba(0,212,177,0.06) 0%, transparent 60%)" }}
      />

      <div className="relative z-10 w-full max-w-[380px]">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex flex-col items-center gap-4">
            <div
              className="w-12 h-12 rounded-xl bg-[#0d1421] border border-[#243552] flex items-center justify-center"
              style={{ boxShadow: "0 0 0 1px rgba(0,212,177,0.06), 0 0 40px rgba(0,212,177,0.07)" }}
            >
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
                <circle cx="11" cy="11" r="8.5" stroke="#00d4b1" strokeWidth="1" strokeOpacity="0.35" />
                <path d="M7.5 11L10 13.5L15 8" stroke="#00d4b1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-[#e4ecf7] tracking-tight">Agent Gateway</h1>
              <p className="font-mono text-[10px] text-[#3a4f68] tracking-[0.25em] uppercase mt-1.5">
                Developer Console
              </p>
            </div>
          </div>
        </div>

        {/* Card */}
        <div
          className="bg-[#0d1421] border border-[#1c2d45] rounded-2xl p-6"
          style={{ boxShadow: "0 32px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.02)" }}
        >
          {/* ── Magic link sent ── */}
          {view === "magic_sent" && (
            <ConfirmationView
              title="Check your inbox"
              body={<>Magic link sent to <span className="text-[#e4ecf7]">{email}</span></>}
              onBack={() => setView("login")}
            />
          )}

          {/* ── Reset link sent ── */}
          {view === "reset_sent" && (
            <ConfirmationView
              title="Reset email sent"
              body={<>Password reset link sent to <span className="text-[#e4ecf7]">{email}</span>. Check your inbox.</>}
              onBack={() => setView("login")}
            />
          )}

          {/* ── Forgot password ── */}
          {view === "reset" && (
            <div className="space-y-4">
              <div>
                <h2 className="font-semibold text-[#e4ecf7] mb-1">Reset password</h2>
                <p className="font-mono text-xs text-[#6b82a0]">
                  Enter your email and we&apos;ll send a reset link.
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="block text-[10px] font-mono font-medium text-[#6b82a0] uppercase tracking-[0.15em]">
                  Email
                </label>
                <input
                  autoFocus
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleResetPassword()}
                  className="w-full bg-[#121b2e] border border-[#1c2d45] rounded-lg px-3 py-2.5 text-sm text-[#e4ecf7] placeholder-[#3a4f68] focus-accent transition-all"
                  placeholder="you@company.com"
                />
              </div>
              {error && <ErrorBanner>{error}</ErrorBanner>}
              <div className="flex gap-3">
                <button
                  onClick={() => { setView("login"); setError(null); }}
                  className="flex-1 bg-[#121b2e] hover:bg-[#1c2d45] border border-[#1c2d45] text-[#6b82a0] rounded-lg py-2.5 text-sm font-medium transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleResetPassword}
                  disabled={loading}
                  className="flex-1 text-[#071a16] rounded-lg py-2.5 text-sm font-bold transition-colors disabled:opacity-50"
                  style={{ background: "#00d4b1" }}
                >
                  {loading ? "Sending…" : "Send link"}
                </button>
              </div>
            </div>
          )}

          {/* ── Main login ── */}
          {view === "login" && (
            <div className="space-y-4">
              <button
                type="button"
                onClick={handleGoogle}
                disabled={loading}
                className="w-full flex items-center justify-center gap-3 rounded-lg py-2.5 text-sm font-medium transition-all disabled:opacity-50 border border-[#243552] hover:border-[#2e4166] hover:bg-[#121b2e] text-[#e4ecf7]"
                style={{ background: "#0f1926" }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
                Continue with Google
              </button>

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-[#1c2d45]" />
                <span className="text-[10px] font-mono text-[#3a4f68]">or continue with email</span>
                <div className="flex-1 h-px bg-[#1c2d45]" />
              </div>

              <form onSubmit={handlePassword} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-mono font-medium text-[#6b82a0] uppercase tracking-[0.15em]">
                    Email
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-[#121b2e] border border-[#1c2d45] rounded-lg px-3 py-2.5 text-sm text-[#e4ecf7] placeholder-[#3a4f68] focus-accent transition-all"
                    placeholder="you@company.com"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="block text-[10px] font-mono font-medium text-[#6b82a0] uppercase tracking-[0.15em]">
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => { setView("reset"); setError(null); }}
                      className="font-mono text-[10px] text-[#3a4f68] hover:text-[#6b82a0] transition-colors"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-[#121b2e] border border-[#1c2d45] rounded-lg px-3 py-2.5 text-sm text-[#e4ecf7] placeholder-[#3a4f68] focus-accent transition-all"
                    placeholder="••••••••"
                  />
                </div>

                {(error || urlError) && (
                  <ErrorBanner>
                    {error ?? (urlError === "auth_failed" ? "Sign-in failed. Try again." : urlError)}
                  </ErrorBanner>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-lg py-2.5 text-sm font-bold tracking-wide transition-all disabled:opacity-50"
                  style={{ background: "#00d4b1", color: "#071a16" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#00c4a3"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#00d4b1"; }}
                >
                  {loading ? "Signing in…" : "Sign in"}
                </button>

                <button
                  type="button"
                  onClick={handleMagicLink}
                  disabled={loading}
                  className="w-full bg-transparent border border-[#1c2d45] hover:border-[#243552] hover:bg-[#121b2e] text-[#6b82a0] hover:text-[#e4ecf7] rounded-lg py-2.5 text-sm font-medium transition-all disabled:opacity-50"
                >
                  Send magic link
                </button>
              </form>
            </div>
          )}
        </div>

        <p className="text-center font-mono text-[10px] text-[#3a4f68] mt-6 tracking-wide">
          Proof-of-Execution · Only pay for verified results
        </p>
      </div>
    </div>
  );
}

function ConfirmationView({
  title,
  body,
  onBack,
}: {
  title: string;
  body: React.ReactNode;
  onBack: () => void;
}) {
  return (
    <div className="text-center py-4">
      <div
        className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4"
        style={{ background: "rgba(0,212,177,0.08)", border: "1px solid rgba(0,212,177,0.2)" }}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M3.5 10L8 14.5L16.5 5.5" stroke="#00d4b1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <p className="font-semibold text-[#e4ecf7]">{title}</p>
      <p className="text-sm text-[#6b82a0] mt-1.5">{body}</p>
      <button
        onClick={onBack}
        className="mt-5 font-mono text-xs text-[#3a4f68] hover:text-[#6b82a0] transition-colors"
      >
        ← Back to sign in
      </button>
    </div>
  );
}

function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-start gap-2 text-xs font-mono px-3 py-2.5 rounded-lg"
      style={{
        color: "#f43a5a",
        background: "rgba(244,58,90,0.08)",
        border: "1px solid rgba(244,58,90,0.2)",
      }}
    >
      {children}
    </div>
  );
}
