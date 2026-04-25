"use client";

/**
 * Hook that fetches the currently authenticated user from `/api/auth/me` and
 * redirects to `/login` if no valid session exists.
 *
 * Components that need the user object should call this hook rather than
 * fetching `/api/auth/me` directly so the redirect logic is centralised.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** The shape returned by `useAuthUser`. */
type AuthState = {
  /** True while the initial session check is in flight. */
  loading: boolean;
  /** The authenticated user, or `null` if unauthenticated. */
  user: any | null;
};

/**
 * Returns the current authentication state.
 *
 * - While loading, `loading` is `true` and `user` is `null`.
 * - Once verified, `loading` becomes `false` and `user` holds the Cognito
 *   JWT payload (same shape as `VerifiedUser` in `lib/auth-server.ts`).
 * - If the session is invalid, the hook redirects to `/login`; `loading`
 *   remains `true` so the component can show a loading state during redirect.
 */
export function useAuthUser(): AuthState {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;

        if (!data.user) {
          router.replace("/login");
          return;
        }

        setUser(data.user);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        router.replace("/login");
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  return { loading, user };
}
