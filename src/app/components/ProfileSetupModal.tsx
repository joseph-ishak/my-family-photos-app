"use client";

import { useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useProfile } from "./ProfileProvider";

export default function ProfileSetupModal() {
  const router = useRouter();
  const pathname = usePathname();
  const { loading, isAuthed, profile } = useProfile();

  const shouldShow = useMemo(() => {
    if (loading) return false;
    if (!isAuthed) return false;
    if (!profile) return false;
    if (profile.profileComplete === true) return false;
    if (pathname.startsWith("/settings")) return false;

    return true;
  }, [loading, isAuthed, profile, pathname]);

  if (!shouldShow) return null;

  const next = encodeURIComponent(pathname || "/home");

  return (
    <div className="fixed inset-0 z-[100]">
      <div className="absolute inset-0 bg-black/70" />

      <div className="absolute inset-0 grid place-items-center p-4">
        <div className="w-full max-w-lg rounded-2xl border border-neutral-800 bg-neutral-950/95 p-6 shadow-xl space-y-4">
          <div className="space-y-2">
            <h2 className="text-xl sm:text-2xl font-semibold text-neutral-50">
              Complete your profile
            </h2>
            <p className="text-sm text-neutral-300">
              Before you can use the app, please add your first name, last name,
              and a username.
            </p>
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 text-sm text-neutral-200">
            This helps everyone in the family know who uploaded photos and who
            is viewing shared events.
          </div>

          <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-end">
            <button
              onClick={async () => {
                await fetch("/api/auth/logout", {
                  method: "POST",
                  credentials: "include",
                });
                router.replace("/login");
              }}
              className="rounded-xl border border-neutral-800 px-5 py-3 hover:bg-neutral-900 transition"
            >
              Sign out
            </button>

            <button
              onClick={() => router.replace(`/settings?setup=1&next=${next}`)}
              className="rounded-xl bg-neutral-50 text-neutral-900 px-5 py-3 font-medium hover:opacity-90 transition"
            >
              Go to settings
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
