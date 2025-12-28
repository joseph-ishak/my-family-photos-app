// src/app/components/family-photos/PhotoCard.tsx
"use client";

import type { Photo } from "../../types/photo";

type Props = {
  photo: Photo;
  canEdit: boolean;
  isSelected: boolean;
  onToggleSelect: (checked: boolean) => void;
  onOpen: () => void;
  onDelete: () => void;
  onUpdate: () => void;
};

function isVideo(photo: Photo) {
  if ((photo as any).mediaType) return (photo as any).mediaType === "video";
  return (photo.mimeType ?? "").startsWith("video/");
}

export default function PhotoCard({
  photo,
  canEdit,
  isSelected,
  onToggleSelect,
  onOpen,
  onDelete,
  onUpdate,
}: Props) {
  const video = isVideo(photo);

  return (
    <div className="overflow-hidden rounded-lg shadow-lg bg-gray-100 relative group">
      {canEdit && (
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => onToggleSelect(e.target.checked)}
          className="absolute top-2 left-2 z-10 w-5 h-5"
        />
      )}

      {video ? (
        <div className="w-full h-56 cursor-pointer relative" onClick={onOpen}>
          <video
            src={photo.url}
            className="w-full h-56 object-cover"
            muted
            playsInline
            preload="metadata"
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="bg-black bg-opacity-50 text-white rounded-full px-3 py-2 text-sm">
              Play
            </div>
          </div>
        </div>
      ) : (
        <img
          src={photo.url}
          alt="Family photo"
          className="w-full h-56 object-cover cursor-pointer"
          onClick={onOpen}
        />
      )}

      <div className="absolute top-2 right-2 flex space-x-2 opacity-0 group-hover:opacity-100 transition">
        {canEdit && (
          <button
            onClick={onDelete}
            className="bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700"
          >
            Delete
          </button>
        )}

        <button
          onClick={video ? undefined : onUpdate}
          disabled={video}
          className="bg-yellow-500 text-white px-2 py-1 rounded hover:bg-yellow-600 disabled:opacity-50"
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
  );
}
