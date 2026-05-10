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

import React, { useRef, useEffect, useState } from "react";
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
 * Returns `true` if the browser can play this video's MIME type.
 * MOV (video/quicktime) is not supported by Firefox — returns false there.
 */
function canBrowserPlay(mimeType?: string): boolean {
  if (!mimeType || typeof document === "undefined") return true;
  const v = document.createElement("video");
  const result = v.canPlayType(mimeType);
  return result === "probably" || result === "maybe";
}

/**
 * Full-screen overlay that shows a photo or plays a video.
 * Returns `null` when `photo` is `null` so it can be unconditionally rendered.
 */
export default function PhotoLightbox({ photo, onClose }: Props) {
  if (!photo) return null;

  const video = isVideo(photo);
  const mimeType = (photo as any).mimeType as string | undefined;
  const playable = !video || canBrowserPlay(mimeType);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-80">
      <div className="relative max-w-[90vw] max-h-[80vh]">
        {video ? (
          playable ? (
            <video
              src={photo.url}
              controls
              autoPlay
              playsInline
              crossOrigin="anonymous"
              className="max-h-[80vh] max-w-[90vw] rounded shadow-lg bg-black"
            >
              {mimeType && <source src={photo.url} type={mimeType} />}
            </video>
          ) : (
            <div className="flex flex-col items-center justify-center gap-4 rounded-lg bg-neutral-900 px-8 py-10 text-center text-white shadow-lg">
              <svg className="h-12 w-12 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
              </svg>
              <p className="text-sm text-neutral-300">
                This video format ({mimeType ?? "unknown"}) can&apos;t be played in this browser.
              </p>
              <a
                href={photo.url}
                download
                className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-100"
              >
                Download to watch
              </a>
            </div>
          )
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
