"use client";

/**
 * Guard component that redirects users with an incomplete profile to the
 * settings page.
 *
 * Wraps any subtree that should be inaccessible until the user has filled in
 * their first name, last name, and username. The redirect is skipped when the
 * user is already on a `/settings` path to prevent an infinite redirect loop.
 *
 * The original destination is preserved as `?next=<encoded-path>` so the
 * settings page can forward the user back after they complete setup.
 *
 * This component renders its children immediately — redirects are handled
 * as a side-effect inside `useEffect` so SSR is unaffected.
 */

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useProfile } from "./ProfileProvider";

/**
 * Renders `children` but redirects to `/settings?setup=1&next=<path>` if the
 * authenticated user's profile is incomplete. No-ops while the profile is still
 * loading or when the user is unauthenticated.
 */
export default function RequireCompleteProfile({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { loading, isAuthed, profile } = useProfile();

  useEffect(() => {
    if (loading) return;
    if (!isAuthed) return;

    const incomplete = profile?.profileComplete === false;
    const onSettings = pathname.startsWith("/settings");

    if (incomplete && !onSettings) {
      const next = encodeURIComponent(pathname || "/home");
      router.replace(`/settings?setup=1&next=${next}`);
    }
  }, [loading, isAuthed, profile, pathname, router]);

  return children;
}
