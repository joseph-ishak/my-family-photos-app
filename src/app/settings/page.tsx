"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useProfile } from "../components/ProfileProvider";

type Profile = {
  nickname: string;
  avatarKey?: string | null;
  avatarUrl?: string | null;
};

export default function SettingsPage() {
  const router = useRouter();
  const { refresh } = useProfile();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [nickname, setNickname] = useState("");

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
      const nick = nickname.trim();
      if (!nick) {
        setError("Nickname is required");
        return;
      }

      const avatarKey = await uploadAvatarIfNeeded();

      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ nickname: nick, avatarKey }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Save failed");
      }

      const data = await res.json();
      const updated: Profile = data.profile;

      setProfile(updated);
      setAvatarFile(null);
      setSuccess("Saved");

      // refresh navbar avatar immediately
      await refresh();

      if (updated.avatarUrl) {
        setAvatarPreview(updated.avatarUrl);
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
    return <p className="p-8 text-center">Loading...</p>;
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div className="bg-white rounded-2xl shadow-md p-6 space-y-2">
        <h1 className="text-3xl font-bold text-gray-800">Account Settings</h1>
        <p className="text-gray-600">
          Update your nickname and profile picture.
        </p>
      </div>

      <div className="bg-white rounded-2xl shadow-md p-6 space-y-6">
        <div className="flex items-center gap-6">
          <div className="w-20 h-20 rounded-full bg-gray-100 overflow-hidden flex items-center justify-center">
            {avatarPreview ? (
              <img
                src={avatarPreview}
                alt="Avatar"
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-gray-400 text-sm">No photo</span>
            )}
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Profile picture
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => onPickAvatar(e.target.files?.[0] ?? null)}
              className="block text-sm text-gray-700"
            />
            <p className="text-xs text-gray-500">
              Use a square image. Keep it under 2 MB.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">
            Nickname
          </label>
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
            maxLength={32}
          />
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {success && (
          <div className="rounded-lg bg-green-50 text-green-700 px-4 py-3 text-sm">
            {success}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save changes"}
          </button>

          <button
            onClick={() => router.push("/home")}
            className="px-6 py-3 rounded-lg border border-gray-300 hover:bg-gray-50"
          >
            Back
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-md p-6 space-y-3">
        <h2 className="text-xl font-semibold text-gray-800">Sign out</h2>
        <p className="text-gray-600">
          This removes your session from this device.
        </p>
        <button
          onClick={async () => {
            await fetch("/api/auth/logout", {
              method: "POST",
              credentials: "include",
            });
            router.replace("/login");
          }}
          className="px-6 py-3 rounded-lg border border-gray-300 hover:bg-gray-50"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
