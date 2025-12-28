// src/app/components/PhotoLightbox.tsx
"use client";

import React from "react";
import type { Photo } from "../family-photos/page";

type Props = {
  photo: Photo | null;
  onClose: () => void;
};

function isVideo(photo: Photo) {
  if ((photo as any).mediaType) return (photo as any).mediaType === "video";
  return (photo.mimeType ?? "").startsWith("video/");
}

export default function PhotoLightbox({ photo, onClose }: Props) {
  if (!photo) return null;

  const video = isVideo(photo);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-80">
      <div className="relative max-w-[90vw] max-h-[80vh]">
        {video ? (
          <video
            src={photo.url}
            controls
            autoPlay
            playsInline
            className="max-h-[80vh] max-w-[90vw] rounded shadow-lg bg-black"
          />
        ) : (
          <img
            src={photo.url}
            alt="Expanded"
            className="max-h-[80vh] max-w-[90vw] rounded shadow-lg"
          />
        )}

        <button
          onClick={onClose}
          className="absolute top-2 right-2 bg-white bg-opacity-80 rounded-full p-2 hover:bg-opacity-100"
          aria-label="Close"
        >
          <svg
            className="h-6 w-6 text-gray-800"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
