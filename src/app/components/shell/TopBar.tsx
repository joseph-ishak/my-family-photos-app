"use client";

/**
 * Sticky top navigation bar rendered on every authenticated page.
 *
 * Shows the app logo/name (links to home), a centred page title derived from
 * the current path, and a user avatar button (links to settings) with a
 * Sign out button on wider screens.
 */

import { useRouter, usePathname } from "next/navigation";
import { useProfile, initials } from "../ProfileProvider";

/**
 * Maps a URL pathname to a human-readable page title shown in the top bar.
 * Returns "Family Photos" for any path that doesn't match a known route.
 */
function titleForPath(path: string) {
  if (path.startsWith("/family-photos")) return "Gallery";
  if (path.startsWith("/events")) return "Events";
  if (path.startsWith("/groups")) return "Groups";
  if (path.startsWith("/settings")) return "Settings";
  if (path.startsWith("/home")) return "Home";
  return "Family Photos";
}

/**
 * Renders the sticky application header with logo, page title, and user controls.
 */
export default function TopBar() {
  const router = useRouter();
  const pathname = usePathname();

  const { loading, profile, isAuthed, clear } = useProfile();

  /**
   * Signs the user out by calling the logout API, clearing the profile context,
   * and redirecting to the login page.
   */
  const handleLogout = async () => {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    clear();
    router.replace("/login");
  };

  return (
    <header className="sticky top-0 z-40 border-b border-neutral-900 bg-neutral-950/85 backdrop-blur">
      <div className="mx-auto w-full max-w-[1800px] px-3 sm:px-4 lg:px-6">
        <div className="h-14 flex items-center justify-between gap-3">
          <button
            onClick={() => router.push("/home")}
            className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-neutral-900 transition"
            aria-label="Go to home"
          >
            <div className="h-8 w-8 rounded-xl bg-neutral-50 text-neutral-900 grid place-items-center font-semibold">
              F
            </div>
            <div className="hidden sm:block font-semibold">Family Photos</div>
          </button>

          <div className="min-w-0 flex-1 text-center">
            <div className="text-sm sm:text-base font-medium truncate">
              {titleForPath(pathname)}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isAuthed ? (
              <>
                <button
                  onClick={() => router.push("/settings")}
                  className="h-9 w-9 rounded-full border border-neutral-800 bg-neutral-900/40 overflow-hidden grid place-items-center"
                  aria-label="Open settings"
                >
                  {!loading && profile?.avatarUrl ? (
                    <img
                      src={profile.avatarUrl}
                      alt="Profile"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="text-xs font-semibold">
                      {initials(profile?.nickname || "User")}
                    </span>
                  )}
                </button>

                <button
                  onClick={handleLogout}
                  className="hidden sm:inline-flex rounded-lg border border-neutral-800 px-3 py-2 text-sm hover:bg-neutral-900 transition"
                >
                  Sign out
                </button>
              </>
            ) : (
              <button
                onClick={() => router.push("/login")}
                className="rounded-lg border border-neutral-800 px-3 py-2 text-sm hover:bg-neutral-900 transition"
              >
                Sign in
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
