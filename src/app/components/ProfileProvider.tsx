"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

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

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used within ProfileProvider");
  return ctx;
}

export function initials(name: string) {
  const parts = name.trim().split(" ").filter(Boolean);
  const first = parts[0]?.[0] ?? "U";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [isAuthed, setIsAuthed] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);

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
