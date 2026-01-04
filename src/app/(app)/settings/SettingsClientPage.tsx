// src/app/(app)/settings/SettingsClientPage.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useProfile } from "../../components/ProfileProvider";
import ContentFrame from "@/app/components/shell/ContentFrame";

type Profile = {
  nickname: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  profileComplete?: boolean;
  avatarKey?: string | null;
  avatarUrl?: string | null;
};

export default function SettingsClientPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refresh } = useProfile();

  const setup = searchParams.get("setup") === "1";
  const next = searchParams.get("next") || "/home";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [profile, setProfile] = useState<Profile | null>(null);

  const [nickname, setNickname] = useState("");
  const [username, setUsername] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/profile", {
          credentials: "include",
          cache: "no-store",
        });

        if (!res.ok) {
          if (!cancelled) setError("Unable to load profile");
          return;
        }

        const data = await res.json();
        const p: Profile = data.profile;

        if (cancelled) return;

        setProfile(p);
        setNickname(p.nickname || "");
        setUsername(p.username || "");
        setFirstName(p.firstName || "");
        setLastName(p.lastName || "");
        setAvatarPreview(p.avatarUrl || null);
      } catch {
        if (!cancelled) setError("Failed to load profile");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function uploadAvatarIfNeeded(): Promise<string | null> {
    if (!avatarFile) return profile?.avatarKey ?? null;

    const res = await fetch("/api/profile/avatar-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        filename: avatarFile.name,
        filetype: avatarFile.type || "application/octet-stream",
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Avatar upload init failed");
    }

    const { signedUrl, s3Key } = await res.json();

    const putRes = await fetch(signedUrl, {
      method: "PUT",
      headers: {
        "Content-Type": avatarFile.type || "application/octet-stream",
      },
      body: avatarFile,
    });

    if (!putRes.ok) throw new Error("Avatar upload failed");

    return s3Key as string;
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const fn = firstName.trim();
      const ln = lastName.trim();
      const un = username.trim().toLowerCase();
      const nick = nickname.trim().slice(0, 32);

      if (!fn) throw new Error("First name is required");
      if (!ln) throw new Error("Last name is required");
      if (!un) throw new Error("Username is required");
      if (!/^[a-z0-9_]{3,20}$/.test(un)) {
        throw new Error(
          "Username must be 3 to 20 characters and use letters numbers or underscore"
        );
      }
      if (!nick) throw new Error("Nickname is required");

      const avatarKey = await uploadAvatarIfNeeded();

      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          nickname: nick,
          avatarKey,
          firstName: fn,
          lastName: ln,
          username: un,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Save failed");
      }

      const data = await res.json();
      setProfile(data.profile);
      setAvatarFile(null);
      setSuccess("Saved");

      await refresh();

      if (setup) {
        router.replace(next);
      }
    } catch (e: any) {
      setError(e?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  function onPickAvatar(file: File | null) {
    setAvatarFile(file);
    setSuccess(null);
    setError(null);

    if (!file) {
      setAvatarPreview(profile?.avatarUrl || null);
      return;
    }

    const preview = URL.createObjectURL(file);
    setAvatarPreview(preview);
  }

  if (loading) {
    return (
      <div className="min-h-[60vh] grid place-items-center">
        <p className="text-sm text-neutral-500">Loading…</p>
      </div>
    );
  }

  return (
    <ContentFrame mode="readable">
      <div className="space-y-6">
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-2">
          <h1 className="text-2xl sm:text-3xl font-semibold">
            {setup ? "Finish setup" : "Account settings"}
          </h1>
          <p className="text-sm text-neutral-300">
            Update your profile info and picture.
          </p>
        </div>

        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 space-y-6">
          <div className="flex items-center gap-6">
            <div className="w-20 h-20 rounded-full bg-neutral-800/40 overflow-hidden flex items-center justify-center border border-neutral-800">
              {avatarPreview ? (
                <img
                  src={avatarPreview}
                  alt="Avatar"
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-neutral-400 text-sm">No photo</span>
              )}
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-neutral-200">
                Profile picture
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => onPickAvatar(e.target.files?.[0] ?? null)}
                className="block text-sm text-neutral-200"
              />
              <p className="text-xs text-neutral-400">
                Use a square image. Keep it under 2 MB.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-neutral-200">
                First name
              </label>
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-neutral-800 bg-neutral-950/40 focus:outline-none focus:ring-2 focus:ring-neutral-300"
                maxLength={32}
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-neutral-200">
                Last name
              </label>
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-neutral-800 bg-neutral-950/40 focus:outline-none focus:ring-2 focus:ring-neutral-300"
                maxLength={32}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-neutral-200">
              Username
            </label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-neutral-800 bg-neutral-950/40 focus:outline-none focus:ring-2 focus:ring-neutral-300"
              maxLength={20}
            />
            <p className="text-xs text-neutral-400">
              Letters numbers underscore only
            </p>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-neutral-200">
              Nickname
            </label>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-neutral-800 bg-neutral-950/40 focus:outline-none focus:ring-2 focus:ring-neutral-300"
              maxLength={32}
            />
          </div>

          {error ? (
            <div className="rounded-xl border border-red-900/40 bg-red-950/30 text-red-200 px-4 py-3 text-sm">
              {error}
            </div>
          ) : null}

          {success ? (
            <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/30 text-emerald-200 px-4 py-3 text-sm">
              {success}
            </div>
          ) : null}

          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-xl bg-neutral-50 text-neutral-900 px-6 py-3 font-medium hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>

            <button
              onClick={() => router.push("/home")}
              className="rounded-xl border border-neutral-800 px-6 py-3 hover:bg-neutral-900 transition"
            >
              Back
            </button>
          </div>
        </div>
      </div>
    </ContentFrame>
  );
}
