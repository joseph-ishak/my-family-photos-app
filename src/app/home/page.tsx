"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useProfile } from "../components/ProfileProvider";

type Photo = {
  key: string;
  url: string;
};

export default function HomePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<{ nickname: string } | null>(null);
  const [recentPhotos, setRecentPhotos] = useState<Photo[]>([]);
  const profile = useProfile();

  useEffect(() => {
    async function fetchUserAndPhotos() {
      try {
        // Get user info
        const resUser = await fetch("/api/auth/me");
        const userData = await resUser.json();
        if (!userData.user) {
          router.push("/login");
          return;
        }
        setUser(userData.user);

        // Get recent photos (last 4)
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

  if (loading) return <p className="p-8 text-center">Loading...</p>;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Welcome Card */}
      <div className="bg-white rounded-lg shadow-md p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">
            Welcome, {profile?.profile?.nickname}!
          </h1>
          <p className="text-gray-600 mt-1">
            Here's a quick overview of your recent uploads.
          </p>
        </div>
        <button
          onClick={() => router.push("/family-photos")}
          className="bg-blue-600 text-white px-6 py-3 rounded shadow hover:bg-blue-700 transition"
        >
          Upload / View Gallery
        </button>
      </div>

      {/* Recent Photos */}
      <div>
        <h2 className="text-2xl font-semibold text-gray-800 mb-4">
          Recent Uploads
        </h2>
        {recentPhotos.length === 0 ? (
          <p className="text-gray-500">No recent photos.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
            {recentPhotos.map((photo) => (
              <div
                key={photo.key}
                className="rounded-lg overflow-hidden shadow hover:scale-105 transform transition"
              >
                <img
                  src={photo.url}
                  alt="Recent upload"
                  className="w-full h-40 object-cover"
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
