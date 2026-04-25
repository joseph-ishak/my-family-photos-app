/**
 * Client-side auth helpers — thin wrappers around the auth API routes.
 *
 * All functions throw on network failures or unexpected HTTP errors so the
 * caller can decide how to surface the error in the UI.
 */

/**
 * Authenticates a user and writes the JWT cookies (`accessToken`, `idToken`,
 * `refreshToken`) via the `/api/auth/login` route handler.
 *
 * @throws {Error} If credentials are wrong or the network call fails.
 */
export async function login(username: string, password: string) {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Login failed");
  }
}

/**
 * Clears all auth cookies by calling `/api/auth/logout`.
 *
 * @throws {Error} If the network call fails.
 */
export async function logout() {
  const res = await fetch("/api/auth/logout", { method: "POST" });
  if (!res.ok) throw new Error("Logout failed");
}

/**
 * Returns the currently authenticated user from `/api/auth/me`, or `null`
 * if no valid session exists.
 */
export async function getSession() {
  const res = await fetch("/api/auth/me");
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return data?.user ?? null;
}

/**
 * Attempts to silently refresh the access/idToken cookies using the stored
 * refreshToken. Returns true on success, false if the refresh token is missing
 * or has expired (requiring the user to log in again).
 */
export async function refreshSession(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/refresh", { method: "POST" });
    return res.ok;
  } catch {
    return false;
  }
}
