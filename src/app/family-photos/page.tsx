"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import PhotoUploadModal from "../components/PhotoUploadModal";
import PhotoLightbox from "../components/PhotoLightbox";

export type Photo = {
  key: string;
  url: string;
  eventId?: string;
  takenAt?: string;
  ownerUserId?: string;
};

export default function FamilyPhotosPage() {
  const router = useRouter();
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [existingEvents, setExistingEvents] = useState<string[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [expandedPhoto, setExpandedPhoto] = useState<Photo | null>(null);
  const [uploading, setUploading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const loader = useRef<HTMLDivElement>(null);

  const [eventFilter, setEventFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [user, setUser] = useState<any>(null);

  // Check auth
  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (!data.user) router.replace("/login");
        else {
          setLoadingAuth(false);
          setUser(data.user);
        }
      });
  }, [router]);

  // Fetch photos page
  const fetchPhotos = async (pageNum: number) => {
    try {
      const res = await fetch(`/api/photos?page=${pageNum}&limit=20`);
      const data = await res.json();
      if (data.photos.length > 0) {
        setPhotos((prev) =>
          pageNum === 1 ? data.photos : [...prev, ...data.photos]
        );
      }
    } catch (err) {
      console.error("Failed to fetch photos", err);
    }
  };

  useEffect(() => {
    fetch("/api/events")
      .then((res) => res.json())
      .then((data) => setExistingEvents(data.events || []));
  }, []);

  useEffect(() => {
    if (page === 1) {
      setPhotos([]);
      fetchPhotos(1);
    } else {
      fetchPhotos(page);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // Infinite scroll observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore) {
          setPage((prev) => prev + 1);
        }
      },
      { threshold: 1 }
    );
    if (loader.current) observer.observe(loader.current);
    return () => observer.disconnect();
  }, [loader, hasMore]);

  // Bulk delete
  const bulkDelete = async () => {
    if (!selectedKeys.length) return;
    if (!confirm("Are you sure you want to delete the selected photos?"))
      return;
    for (const key of selectedKeys) {
      await deletePhoto(key, false);
    }
    setSelectedKeys([]);
    setPhotos((prev) => prev.filter((p) => !selectedKeys.includes(p.key)));
  };

  // Delete photo
  const deletePhoto = async (key: string, confirmSingle = true) => {
    if (
      confirmSingle &&
      !confirm("Are you sure you want to delete this photo?")
    )
      return;
    try {
      const res = await fetch(`/api/photos?key=${encodeURIComponent(key)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      setPhotos((prev) => prev.filter((p) => p.key !== key));
      setSelectedKeys((prev) => prev.filter((k) => k !== key));
    } catch (err) {
      console.error(err);
      alert("Delete failed");
    }
  };

  // Filtered photos
  const filteredPhotos = photos
    .filter((p) =>
      eventFilter
        ? p.eventId?.toLowerCase().includes(eventFilter.toLowerCase())
        : true
    )
    .filter((p) => (dateFilter ? p.takenAt?.startsWith(dateFilter) : true))
    .sort((a, b) =>
      a.takenAt && b.takenAt
        ? new Date(b.takenAt).getTime() - new Date(a.takenAt).getTime()
        : 0
    );

  // Handler for successful upload
  const handleUploadSuccess = () => {
    setPhotos([]);
    setPage(1);
    setHasMore(true);
    if (page === 1) {
      fetchPhotos(1);
    } else {
      setPage(1);
    }
  };

  if (loadingAuth)
    return <p className="p-4 text-center">Checking authentication...</p>;

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold mb-4 text-center text-gray-800">
        Family Photo Gallery
      </h1>

      <button
        onClick={() => setModalOpen(true)}
        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3 rounded-lg shadow transition duration-150 mx-auto block"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 4v16m8-8H4"
          />
        </svg>
        Upload Photo
      </button>
      <PhotoUploadModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onUploadSuccess={handleUploadSuccess}
        existingEvents={existingEvents}
        user={user}
      />

      {/* Expanded photo lightbox */}
      <PhotoLightbox
        photo={expandedPhoto}
        onClose={() => setExpandedPhoto(null)}
      />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-center mb-4">
        <select
          value={eventFilter}
          onChange={(e) => setEventFilter(e.target.value)}
          className="border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All events</option>
          {existingEvents.map((ev) => (
            <option key={ev} value={ev}>
              {ev}
            </option>
          ))}
        </select>
        <input
          type="date"
          placeholder="Filter by date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={() => {
            setEventFilter("");
            setDateFilter("");
          }}
          className="bg-gray-300 text-gray-800 px-4 py-2 rounded hover:bg-gray-400 transition"
        >
          Clear Filters
        </button>
      </div>

      {/* Bulk delete button */}
      {selectedKeys.length > 0 && (
        <div className="flex justify-end mb-2">
          <button
            onClick={bulkDelete}
            className="bg-red-600 text-white px-4 py-2 rounded shadow hover:bg-red-700"
          >
            Delete Selected ({selectedKeys.length})
          </button>
        </div>
      )}

      {/* Gallery */}
      <div className="grid gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {filteredPhotos.map((photo) => (
          <div
            key={photo.key}
            className="overflow-hidden rounded-lg shadow-lg bg-gray-100 relative group"
          >
            {/* Checkbox for bulk delete (owner only) */}
            {photo.ownerId === user?.sub && (
              <input
                type="checkbox"
                checked={selectedKeys.includes(photo.key)}
                onChange={(e) => {
                  setSelectedKeys((keys) =>
                    e.target.checked
                      ? [...keys, photo.key]
                      : keys.filter((k) => k !== photo.key)
                  );
                }}
                className="absolute top-2 left-2 z-10 w-5 h-5"
              />
            )}
            <img
              src={photo.url}
              alt="Family photo"
              className="w-full h-56 object-cover cursor-pointer"
              onClick={() => setExpandedPhoto(photo)}
            />
            <div className="absolute top-2 right-2 flex space-x-2 opacity-0 group-hover:opacity-100 transition">
              {photo.ownerUserId === user?.sub && (
                <button
                  onClick={() => deletePhoto(photo.key)}
                  className="bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700"
                >
                  Delete
                </button>
              )}
              {/* Update/Crop button placeholder */}
              <button
                onClick={() => alert("Update/Crop not implemented yet")}
                className="bg-yellow-500 text-white px-2 py-1 rounded hover:bg-yellow-600"
              >
                Update
              </button>
            </div>
            <div className="p-2 text-gray-700 text-sm">
              <p>{photo.eventId || "No event"}</p>
              <p>
                {photo.takenAt
                  ? new Date(photo.takenAt).toLocaleDateString()
                  : "No date"}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div ref={loader} className="h-10" />
      {!hasMore && (
        <p className="text-center text-gray-500 mt-4">No more photos.</p>
      )}
    </div>
  );
}
