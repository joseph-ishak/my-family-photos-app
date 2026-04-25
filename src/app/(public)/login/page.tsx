"use client";

/**
 * Login page (`/login`) — handles all authentication flows in one form:
 *
 * - **`"login"`** — standard username + password sign-in. If Cognito returns
 *   `NEW_PASSWORD_REQUIRED` (e.g. an admin-created account), a second password
 *   field is revealed for the forced password change.
 * - **`"forgotStart"`** — initiates a forgot-password flow by sending a
 *   verification code via `POST /api/auth/forgot-password`.
 * - **`"forgotConfirm"`** — completes the reset by submitting the code and new
 *   password via `POST /api/auth/reset-password`.
 *
 * On successful login the page redirects to the `?next=` query param or `/home`.
 * The first input receives focus automatically when the `mode` changes.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/** Eye icon for the password visibility toggle. `open` = password is visible. */
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
      <path d="M3 5l18 14" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M10.6 10.3A3 3 0 0 0 12 15a3 3 0 0 0 2.7-1.7"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );

/** Animated spinner shown inside the submit button while loading. */
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

/** Discriminated union representing which authentication sub-form is active. */
type Mode = "login" | "forgotStart" | "forgotConfirm";

/**
 * Safely parses a JSON response body.
 * Returns `{}` on parse error so callers can use optional-chaining safely.
 */
async function readJsonSafe(res: Response) {
  return (await res.json().catch(() => ({}))) as any;
}

/** Multi-mode authentication form for login and password reset. */
export default function LoginPage() {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("login");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [needsNewPassword, setNeedsNewPassword] = useState(false);

  const [resetCode, setResetCode] = useState("");
  const [resetPassword, setResetPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, [mode]);

  const canSubmit = useMemo(() => {
    if (loading) return false;

    const u = username.trim();

    if (mode === "login") {
      if (!u) return false;
      if (!password) return false;
      if (needsNewPassword && !newPassword) return false;
      return true;
    }

    if (mode === "forgotStart") {
      if (!u) return false;
      return true;
    }

    if (mode === "forgotConfirm") {
      if (!u) return false;
      if (!resetCode.trim()) return false;
      if (!resetPassword) return false;
      return true;
    }

    return false;
  }, [
    loading,
    mode,
    username,
    password,
    needsNewPassword,
    newPassword,
    resetCode,
    resetPassword,
  ]);

  /**
   * Submits the login form. On success redirects to `?next` or `/home`.
   * On `NEW_PASSWORD_REQUIRED` (409) reveals the new-password field.
   */
  async function handleLogin() {
    if (!canSubmit) return;

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
        const params = new URLSearchParams(window.location.search);
        const next = params.get("next") || "/home";
        router.replace(next);
        router.refresh();
        return;
      }

      const data = await readJsonSafe(res);

      if (res.status === 409 && data?.error === "NEW_PASSWORD_REQUIRED") {
        setNeedsNewPassword(true);
        setInfo("This account requires a new password.");
        return;
      }

      setError(data?.error ?? "Login failed");
    } finally {
      setLoading(false);
    }
  }

  /**
   * Sends the forgot-password request. On success transitions to
   * `"forgotConfirm"` mode and shows an instruction message.
   */
  async function handleForgotStart() {
    if (!canSubmit) return;

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
        setResetCode("");
        setResetPassword("");
        setInfo("Check your email for the verification code.");
        return;
      }

      const data = await readJsonSafe(res);
      setError(data?.error ?? "Could not start reset");
    } finally {
      setLoading(false);
    }
  }

  /**
   * Submits the password reset confirmation. On success returns to login mode
   * with an "Password updated" info message.
   */
  async function handleForgotConfirm() {
    setLoading(true);
    setError(null);
    setInfo(null);

    const payload = {
      username: username.trim(),
      code: resetCode.trim(),
      newPassword: resetPassword,
    };

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setMode("login");
        setPassword("");
        setResetCode("");
        setResetPassword("");
        setInfo("Password updated. Please sign in.");
        return;
      }

      const data = await readJsonSafe(res);
      setError(data?.error ?? "Reset failed");
    } finally {
      setLoading(false);
    }
  }

  /** Form submit handler — delegates to the appropriate async handler based on `mode`. */
  function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (mode === "login") handleLogin();
    else if (mode === "forgotStart") handleForgotStart();
    else handleForgotConfirm();
  }

  return (
    <div className="min-h-[100dvh] bg-black text-neutral-100 grid place-items-center px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-3xl font-semibold">Family Photo Gallery</h1>
          <p className="text-sm text-white/60">
            {mode === "login"
              ? "Sign in to access your family archive"
              : mode === "forgotStart"
              ? "Reset your password"
              : "Enter the verification code"}
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-3xl border border-white/10 bg-neutral-950/60 p-6 space-y-4"
        >
          <input
            ref={firstFieldRef}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username or email"
            disabled={loading || mode === "forgotConfirm"}
            className="h-11 w-full rounded-2xl border border-white/10 bg-neutral-950 px-4 text-sm"
          />

          {mode === "login" && (
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              disabled={loading}
              className="h-11 w-full rounded-2xl border border-white/10 bg-neutral-950 px-4 text-sm"
            />
          )}

          {mode === "forgotConfirm" && (
            <>
              <input
                value={resetCode}
                onChange={(e) => setResetCode(e.target.value)}
                placeholder="Verification code"
                disabled={loading}
                className="h-11 w-full rounded-2xl border border-white/10 bg-neutral-950 px-4 text-sm"
              />

              <input
                type={showResetPassword ? "text" : "password"}
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                placeholder="New password"
                disabled={loading}
                className="h-11 w-full rounded-2xl border border-white/10 bg-neutral-950 px-4 text-sm"
              />
            </>
          )}

          {error && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          )}

          {info && (
            <div className="rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-sm text-white/70">
              {info}
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit || loading}
            className="h-11 w-full rounded-2xl bg-neutral-50 text-neutral-900 font-medium disabled:opacity-50"
          >
            {loading
              ? "Please wait…"
              : mode === "login"
              ? "Sign in"
              : "Continue"}
          </button>

          <div className="flex justify-between text-sm text-white/60">
            {mode === "login" ? (
              <button
                type="button"
                onClick={() => {
                  setMode("forgotStart");
                  setError(null);
                  setInfo(null);
                  setPassword("");
                }}
              >
                Forgot password
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setMode("login");
                  setError(null);
                  setInfo(null);
                }}
              >
                Back to sign in
              </button>
            )}
            <span>Private family access</span>
          </div>
        </form>
      </div>
    </div>
  );
}
