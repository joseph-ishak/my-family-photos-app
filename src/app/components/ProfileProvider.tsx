"use client";

/**
 * React context that holds the authenticated user's profile and exposes helpers
 * to refresh or clear it. Wraps the entire authenticated layout so any component
 * in the tree can access profile data without prop-drilling.
 *
 * On mount, `ProfileProvider` calls `/api/auth/me` to confirm the session is
 * still valid, then fetches `/api/profile` to hydrate the profile object.
 */

import React, { createContext, useContext, useEffect, useState } from "react";

/** The subset of profile fields exposed through the context. */
type Profile = {
  nickname: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  profileComplete?: boolean;
  avatarKey?: string | null;
  avatarUrl?: string | null;
};
type ProfileContextValue = {
  loading: boolean;
  isAuthed: boolean;
  profile: Profile | null;
  refresh: () => Promise<void>;
  clear: () => void;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);

/**
 * Returns the nearest `ProfileContext` value. Must be called from a component
 * that is a descendant of `ProfileProvider`; throws otherwise.
 */
export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used within ProfileProvider");
  return ctx;
}

/**
 * Generates a two-letter uppercase monogram from a display name.
 * Used for avatar placeholders when no profile image is set.
 *
 * @example initials("Jane Doe") → "JD"
 * @example initials("Alice")    → "A"
 */
export function initials(name: string) {
  const parts = name.trim().split(" ").filter(Boolean);
  const first = parts[0]?.[0] ?? "U";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

/**
 * Provides `ProfileContext` to the component tree. Fetches the session and
 * profile on mount. Exposes `refresh()` to re-fetch after a profile update
 * and `clear()` to wipe state on logout.
 */
export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [isAuthed, setIsAuthed] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);

  /**
   * Re-fetches the session from `/api/auth/me` and the profile from
   * `/api/profile`, updating context state. Safe to call at any time.
   */
  async function refresh() {
    setLoading(true);

    try {
      const meRes = await fetch("/api/auth/me", {
        credentials: "include",
        cache: "no-store",
      });

      const meData = await meRes.json().catch(() => null);
      const user = meData?.user ?? null;

      if (!user) {
        setIsAuthed(false);
        setProfile(null);
        return;
      }

      setIsAuthed(true);

      const profRes = await fetch("/api/profile", {
        credentials: "include",
        cache: "no-store",
      });

      if (!profRes.ok) {
        setProfile(null);
        return;
      }

      const profData = await profRes.json().catch(() => null);
      setProfile(profData?.profile ?? null);
    } catch {
      setIsAuthed(false);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }

  /**
   * Resets all profile state to unauthenticated defaults. Called immediately
   * after a successful logout so the UI reflects the signed-out state.
   */
  function clear() {
    setIsAuthed(false);
    setProfile(null);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <ProfileContext.Provider
      value={{ loading, isAuthed, profile, refresh, clear }}
    >
      {children}
    </ProfileContext.Provider>
  );
}
