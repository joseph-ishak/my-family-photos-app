"use client";

/**
 * Legacy top navigation bar — superseded by `TopBar` + `SideNav` + `BottomNav`.
 *
 * @deprecated Not rendered anywhere in the current app shell. Kept for
 * reference only. Use the `(app)` layout components instead.
 *
 * Renders a blue sticky nav with desktop link buttons and a mobile hamburger
 * menu. Calls `POST /api/auth/logout` then clears profile context on sign-out.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useProfile, initials } from "./ProfileProvider";

/** @deprecated Superseded by `TopBar`/`SideNav`/`BottomNav`. */
export default function Navbar() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);

  const { loading, profile, isAuthed, clear } = useProfile();

  /** Signs the user out and redirects to `/login`. */
  const handleLogout = async () => {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    clear();
    router.replace("/login");
  };

  return (
    <nav className="sticky top-0 z-40 bg-blue-600 text-white shadow-md">
      <div className="h-16 flex items-center justify-between">
        <div
          className="flex-shrink-0 text-2xl font-bold cursor-pointer"
          onClick={() => router.push("/home")}
        >
          Family Photos
        </div>

        <div className="hidden md:flex space-x-6 items-center">
          <button
            onClick={() => router.push("/home")}
            className="hover:text-gray-200"
          >
            Home
          </button>

          <button
            onClick={() => router.push("/family-photos")}
            className="hover:text-gray-200"
          >
            Gallery
          </button>

          <button
            onClick={() => router.push("/events")}
            className="hover:text-gray-200"
          >
            Events
          </button>

          {isAuthed && (
            <>
              <button
                onClick={() => router.push("/settings")}
                className="hover:text-gray-200"
              >
                Settings
              </button>

              <button onClick={handleLogout} className="hover:text-gray-200">
                Logout
              </button>

              <button
                onClick={() => router.push("/settings")}
                className="w-9 h-9 rounded-full bg-white/20 overflow-hidden flex items-center justify-center border border-white/30"
                aria-label="Open settings"
              >
                {!loading && profile?.avatarUrl ? (
                  <img
                    src={profile.avatarUrl}
                    alt="Profile"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-xs font-semibold">
                    {initials(profile?.nickname || "User")}
                  </span>
                )}
              </button>
            </>
          )}
        </div>

        <div className="md:hidden flex items-center gap-3">
          {isAuthed && (
            <button
              onClick={() => router.push("/settings")}
              className="w-9 h-9 rounded-full bg-white/20 overflow-hidden flex items-center justify-center border border-white/30"
              aria-label="Open settings"
            >
              {!loading && profile?.avatarUrl ? (
                <img
                  src={profile.avatarUrl}
                  alt="Profile"
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-xs font-semibold">
                  {initials(profile?.nickname || "User")}
                </span>
              )}
            </button>
          )}

          <button
            onClick={() => setIsOpen(!isOpen)}
            className="focus:outline-none"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              {isOpen ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              )}
            </svg>
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="md:hidden bg-blue-600 pt-2 pb-4 space-y-2">
          <button
            onClick={() => {
              router.push("/home");
              setIsOpen(false);
            }}
            className="block w-full text-left hover:text-gray-200"
          >
            Home
          </button>

          <button
            onClick={() => {
              router.push("/family-photos");
              setIsOpen(false);
            }}
            className="block w-full text-left hover:text-gray-200"
          >
            Gallery
          </button>

          <button
            onClick={() => {
              router.push("/events");
              setIsOpen(false);
            }}
            className="block w-full text-left hover:text-gray-200"
          >
            Events
          </button>

          {isAuthed && (
            <>
              <button
                onClick={() => {
                  router.push("/settings");
                  setIsOpen(false);
                }}
                className="block w-full text-left hover:text-gray-200"
              >
                Settings
              </button>

              <button
                onClick={async () => {
                  await handleLogout();
                  setIsOpen(false);
                }}
                className="block w-full text-left hover:text-gray-200"
              >
                Logout
              </button>
            </>
          )}
        </div>
      )}
    </nav>
  );
}
