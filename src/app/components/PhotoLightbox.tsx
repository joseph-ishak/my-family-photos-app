// src/app/components/PhotoLightbox.tsx
"use client";

/**
 * Minimal full-screen lightbox for expanding a single photo or playing a video.
 *
 * Renders over a dark backdrop and displays either an `<img>` or a `<video>`
 * depending on the media type. A close button (✕) is overlaid in the top-right
 * corner. For a richer viewer with navigation, transitions, and keyboard
 * shortcuts use `PhotoSlideshow` instead.
 */

import React from "react";
import type { Photo } from "../../types/photo";

/** Props accepted by `PhotoLightbox`. */
type Props = {
  /** The photo to display, or `null` to hide the lightbox. */
  photo: Photo | null;
  /** Called when the user clicks the close button. */
  onClose: () => void;
};

/**
 * Returns `true` if the given photo represents a video file.
 * Checks the `mediaType` field first (preferred), then falls back to
 * the `mimeType` prefix for backward compatibility.
 */
function isVideo(photo: Photo) {
  if ((photo as any).mediaType) return (photo as any).mediaType === "video";
  return (photo.mimeType ?? "").startsWith("video/");
}

/**
 * Full-screen overlay that shows a photo or plays a video.
 * Returns `null` when `photo` is `null` so it can be unconditionally rendered.
 */
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
