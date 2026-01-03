"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useProfile } from "../../components/ProfileProvider";

const EyeIcon = ({ open }: { open: boolean }) =>
  open ? (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
      <path
        d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  ) : (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
      <path
        d="M3 5l18 14"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M10.6 10.3A3 3 0 0 0 12 15a3 3 0 0 0 2.7-1.7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M5.2 9.1C3.6 10.6 2.5 12 2.5 12s3.5 7 9.5 7c2.2 0 4.1-.6 5.6-1.4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M8.2 6.2C9.4 5.6 10.7 5 12 5c6 0 9.5 7 9.5 7s-.9 1.8-2.8 3.6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );

const Spinner = () => (
  <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
    <path
      d="M12 3a9 9 0 1 0 9 9"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

type Mode = "login" | "forgotStart" | "forgotConfirm";

async function readJsonSafe(res: Response) {
  return (await res.json().catch(() => ({}))) as any;
}

export default function LoginPage() {
  const router = useRouter();
  const { refresh } = useProfile();

  const [mode, setMode] = useState<Mode>("login");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [needsNewPassword, setNeedsNewPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  const [resetCode, setResetCode] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);

  const [capsLockOn, setCapsLockOn] = useState(false);

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  const canSubmitLogin = useMemo(() => {
    if (loading) return false;
    if (!username.trim()) return false;
    if (!password) return false;
    if (needsNewPassword && !newPassword) return false;
    return true;
  }, [loading, username, password, needsNewPassword, newPassword]);

  const canSubmitForgotStart = useMemo(() => {
    if (loading) return false;
    if (!username.trim()) return false;
    return true;
  }, [loading, username]);

  const canSubmitForgotConfirm = useMemo(() => {
    if (loading) return false;
    if (!username.trim()) return false;
    if (!resetCode.trim()) return false;
    if (!resetPassword) return false;
    return true;
  }, [loading, username, resetCode, resetPassword]);

  const handleLogin = async () => {
    if (!canSubmitLogin) return;

    setLoading(true);
    setError(null);
    setInfo(null);

    try {
      const body: any = { username: username.trim(), password };
      if (needsNewPassword) body.newPassword = newPassword;

      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });

      if (res.ok) {
        await refresh();
        const params = new URLSearchParams(window.location.search);
        const next = params.get("next") || "/home";
        router.push(next);
        return;
      }

      const data = await readJsonSafe(res);

      if (res.status === 409 && data?.error === "NEW_PASSWORD_REQUIRED") {
        setNeedsNewPassword(true);
        setInfo("This account requires a new password before you can sign in.");
        return;
      }

      setError(data?.error ? String(data.error) : "Login failed");
    } catch (err) {
      console.error(err);
      setError("An error occurred during login");
    } finally {
      setLoading(false);
    }
  };

  const handleForgotStart = async () => {
    if (!canSubmitForgotStart) return;

    setLoading(true);
    setError(null);
    setInfo(null);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username: username.trim() }),
      });

      if (res.ok) {
        setMode("forgotConfirm");
        setInfo("Check your email for a verification code.");
        setResetCode("");
        setResetPassword("");
        setTimeout(() => {
          firstFieldRef.current?.focus();
        }, 0);
        return;
      }

      const data = await readJsonSafe(res);
      setError(data?.error ? String(data.error) : "Could not start reset");
    } catch (err) {
      console.error(err);
      setError("An error occurred while starting reset");
    } finally {
      setLoading(false);
    }
  };

  const handleForgotConfirm = async () => {
    if (!canSubmitForgotConfirm) return;

    setLoading(true);
    setError(null);
    setInfo(null);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          username: username.trim(),
          code: resetCode.trim(),
          newPassword: resetPassword,
        }),
      });

      if (res.ok) {
        setMode("login");
        setNeedsNewPassword(false);
        setPassword("");
        setNewPassword("");
        setResetCode("");
        setResetPassword("");
        setInfo("Password updated. Please sign in.");
        setTimeout(() => {
          firstFieldRef.current?.focus();
        }, 0);
        return;
      }

      const data = await readJsonSafe(res);
      setError(data?.error ? String(data.error) : "Reset failed");
    } catch (err) {
      console.error(err);
      setError("An error occurred while resetting password");
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (mode === "login") handleLogin();
    if (mode === "forgotStart") handleForgotStart();
    if (mode === "forgotConfirm") handleForgotConfirm();
  };

  const onKeyAny = (e: React.KeyboardEvent) => {
    setCapsLockOn(
      Boolean(e.getModifierState && e.getModifierState("CapsLock"))
    );
  };

  const goToForgot = () => {
    setError(null);
    setInfo(null);
    setMode("forgotStart");
    setTimeout(() => {
      firstFieldRef.current?.focus();
    }, 0);
  };

  const goToLogin = () => {
    setError(null);
    setInfo(null);
    setMode("login");
    setNeedsNewPassword(false);
    setNewPassword("");
    setResetCode("");
    setResetPassword("");
    setTimeout(() => {
      firstFieldRef.current?.focus();
    }, 0);
  };

  const title =
    mode === "login"
      ? needsNewPassword
        ? "Set a new password"
        : "Sign in"
      : mode === "forgotStart"
      ? "Reset password"
      : "Enter verification code";

  const subtitle =
    mode === "login"
      ? "Sign in to access your family archive."
      : mode === "forgotStart"
      ? "We will email you a verification code."
      : "Enter the code and choose a new password.";

  return (
    <div className="min-h-[100dvh] bg-black text-neutral-100">
      <div className="absolute inset-0 opacity-60">
        <div className="h-full w-full bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.10),transparent_55%),radial-gradient(circle_at_80%_40%,rgba(255,255,255,0.06),transparent_55%)]" />
      </div>

      <div className="relative min-h-[100dvh] grid place-items-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="mb-6 text-center space-y-2">
            <div className="text-2xl sm:text-3xl font-semibold tracking-tight">
              Family Photo Gallery
            </div>
            <p className="text-sm text-white/60">{subtitle}</p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-neutral-950/50 p-6 shadow-2xl backdrop-blur space-y-5">
            <div className="space-y-1">
              <div className="text-lg font-semibold text-white/90">{title}</div>
              {capsLockOn ? (
                <div className="text-xs text-amber-200/80">
                  Caps Lock appears to be on
                </div>
              ) : null}
            </div>

            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs text-white/60">
                  Username or email
                </label>
                <input
                  ref={firstFieldRef}
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onKeyDown={onKeyAny}
                  placeholder="Username or email"
                  disabled={loading || mode === "forgotConfirm"}
                  className="h-11 w-full rounded-2xl border border-white/10 bg-neutral-950/60 px-4 text-sm text-white/90 outline-none focus:ring-2 focus:ring-white/20 disabled:opacity-60"
                />
              </div>

              {mode === "login" ? (
                <>
                  <div className="space-y-2">
                    <label className="text-xs text-white/60">
                      {needsNewPassword ? "Temporary password" : "Password"}
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onKeyDown={onKeyAny}
                        placeholder={
                          needsNewPassword ? "Temporary password" : "Password"
                        }
                        disabled={loading}
                        className="h-11 w-full rounded-2xl border border-white/10 bg-neutral-950/60 px-4 pr-12 text-sm text-white/90 outline-none focus:ring-2 focus:ring-white/20"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        disabled={loading}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl p-2 text-white/55 hover:text-white/85 transition disabled:opacity-50"
                        aria-label={
                          showPassword ? "Hide password" : "Show password"
                        }
                      >
                        <EyeIcon open={showPassword} />
                      </button>
                    </div>
                  </div>

                  {needsNewPassword ? (
                    <div className="space-y-2">
                      <label className="text-xs text-white/60">
                        New password
                      </label>
                      <div className="relative">
                        <input
                          type={showNewPassword ? "text" : "password"}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          onKeyDown={onKeyAny}
                          placeholder="New password"
                          disabled={loading}
                          className="h-11 w-full rounded-2xl border border-white/10 bg-neutral-950/60 px-4 pr-12 text-sm text-white/90 outline-none focus:ring-2 focus:ring-white/20"
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewPassword((v) => !v)}
                          disabled={loading}
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl p-2 text-white/55 hover:text-white/85 transition disabled:opacity-50"
                          aria-label={
                            showNewPassword
                              ? "Hide new password"
                              : "Show new password"
                          }
                        >
                          <EyeIcon open={showNewPassword} />
                        </button>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}

              {mode === "forgotConfirm" ? (
                <>
                  <div className="space-y-2">
                    <label className="text-xs text-white/60">
                      Verification code
                    </label>
                    <input
                      type="text"
                      value={resetCode}
                      onChange={(e) => setResetCode(e.target.value)}
                      onKeyDown={onKeyAny}
                      placeholder="Code"
                      disabled={loading}
                      className="h-11 w-full rounded-2xl border border-white/10 bg-neutral-950/60 px-4 text-sm text-white/90 outline-none focus:ring-2 focus:ring-white/20"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs text-white/60">
                      New password
                    </label>
                    <div className="relative">
                      <input
                        type={showResetPassword ? "text" : "password"}
                        value={resetPassword}
                        onChange={(e) => setResetPassword(e.target.value)}
                        onKeyDown={onKeyAny}
                        placeholder="New password"
                        disabled={loading}
                        className="h-11 w-full rounded-2xl border border-white/10 bg-neutral-950/60 px-4 pr-12 text-sm text-white/90 outline-none focus:ring-2 focus:ring-white/20"
                      />
                      <button
                        type="button"
                        onClick={() => setShowResetPassword((v) => !v)}
                        disabled={loading}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl p-2 text-white/55 hover:text-white/85 transition disabled:opacity-50"
                        aria-label={
                          showResetPassword
                            ? "Hide new password"
                            : "Show new password"
                        }
                      >
                        <EyeIcon open={showResetPassword} />
                      </button>
                    </div>
                  </div>
                </>
              ) : null}

              {error ? (
                <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {error}
                </div>
              ) : null}

              {info ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">
                  {info}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={
                  mode === "login"
                    ? !canSubmitLogin
                    : mode === "forgotStart"
                    ? !canSubmitForgotStart
                    : !canSubmitForgotConfirm
                }
                className="h-11 w-full rounded-2xl bg-neutral-50 text-neutral-900 text-sm font-medium hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? <Spinner /> : null}
                {mode === "login"
                  ? loading
                    ? "Signing in…"
                    : needsNewPassword
                    ? "Set new password"
                    : "Sign in"
                  : mode === "forgotStart"
                  ? loading
                    ? "Sending…"
                    : "Send code"
                  : loading
                  ? "Updating…"
                  : "Update password"}
              </button>

              <div className="flex items-center justify-between text-sm pt-1">
                {mode === "login" ? (
                  <button
                    type="button"
                    onClick={goToForgot}
                    disabled={loading}
                    className="text-white/60 hover:text-white/85 transition disabled:opacity-50"
                  >
                    Forgot password
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={goToLogin}
                    disabled={loading}
                    className="text-white/60 hover:text-white/85 transition disabled:opacity-50"
                  >
                    Back to sign in
                  </button>
                )}

                <div className="text-white/40 text-xs">
                  Private family access
                </div>
              </div>
            </form>
          </div>

          <div className="mt-6 text-center text-xs text-white/35">
            Tip: you can share a link with a next parameter to send someone back
            where they started.
          </div>

          <div className="mt-3 text-center text-[11px] text-white/35">
            If your reset endpoints differ, update the two fetch URLs in this
            file:
            <span className="text-white/50"> /api/auth/forgot-password </span>
            and
            <span className="text-white/50"> /api/auth/reset-password</span>
          </div>
        </div>
      </div>
    </div>
  );
}
