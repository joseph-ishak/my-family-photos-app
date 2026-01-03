"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useProfile } from "@/app/components/ProfileProvider";
import ContentFrame from "@/app/components/shell/ContentFrame";

type Photo = {
  key: string;
  url: string;
  thumbnailUrl?: string;
};

export default function HomePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [recentPhotos, setRecentPhotos] = useState<Photo[]>([]);
  const profile = useProfile();

  useEffect(() => {
    async function fetchUserAndPhotos() {
      try {
        const resUser = await fetch("/api/auth/me");
        const userData = await resUser.json();
        if (!userData.user) {
          router.push("/login");
          return;
        }

        const resPhotos = await fetch("/api/photos?limit=4");
        const photosData = await resPhotos.json();
        setRecentPhotos(photosData.photos || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    fetchUserAndPhotos();
  }, [router]);

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
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-semibold">
              Welcome, {profile?.profile?.nickname}!
            </h1>
            <p className="text-sm text-neutral-300 mt-1">
              Here is a quick overview of your recent uploads.
            </p>
          </div>

          <button
            onClick={() => router.push("/family-photos")}
            className="px-5 py-3 rounded-xl bg-neutral-50 text-neutral-900 font-medium hover:opacity-90 transition"
          >
            Upload and view gallery
          </button>
        </div>

        <div className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <h2 className="text-lg sm:text-xl font-semibold">Recent uploads</h2>

            <button
              onClick={() => router.push("/family-photos")}
              className="text-sm text-neutral-300 hover:text-neutral-50 transition"
            >
              View all
            </button>
          </div>

          {recentPhotos.length === 0 ? (
            <p className="text-sm text-neutral-400">No recent photos.</p>
          ) : (
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
              {recentPhotos.map((photo) => (
                <button
                  key={photo.key}
                  onClick={() => router.push("/family-photos")}
                  className="rounded-2xl overflow-hidden border border-neutral-800 bg-neutral-900/40 hover:opacity-95 transition"
                >
                  <img
                    src={photo.thumbnailUrl}
                    alt="Recent upload"
                    className="w-full aspect-square object-cover"
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </ContentFrame>
  );
}
