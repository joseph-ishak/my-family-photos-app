"use client";

import type { Photo } from "../../../types/photo";
import { downloadPhoto } from "@/lib/download";

type Props = {
  photo: Photo;
  canEdit: boolean;
  isSelected: boolean;
  onToggleSelect: (checked: boolean) => void;
  onOpen: () => void;
  onDelete: () => void;
  onUpdate: () => void;
};

/** Returns `true` if the photo item is a video based on `mediaType` or MIME type. */
function isVideo(photo: Photo) {
  if ((photo as any).mediaType) return (photo as any).mediaType === "video";
  return (photo.mimeType ?? "").startsWith("video/");
}

/**
 * Formats an ISO 8601 date string as a locale-aware date string.
 * Returns `null` for absent or unparseable values.
 */
function formatDate(value?: string) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString();
}

/**
 * Returns the owner's display nickname from the photo, trying several
 * field names for backwards compatibility. Returns `null` if none are present.
 */
function getNickname(photo: Photo) {
  const raw =
    (photo as any).ownerNickname ||
    (photo as any).nickname ||
    (photo as any).preferred_username ||
    "";
  const nick = typeof raw === "string" ? raw.trim() : "";
  return nick || null;
}

/**
 * Derives a two-letter avatar monogram from a display name.
 * Uses the first letter of the first word and the first letter of the last word.
 * Falls back to just the first character when the name is a single word.
 */
function initialsFromName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";

  const out = (first + last).toUpperCase();
  return out || name.slice(0, 1).toUpperCase();
}

/** Inline SVG trash icon used on the delete action button. */
const TrashIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none">
    <path
      d="M9 3h6m-8 4h10m-9 0 1 14h6l1-14M10 7v12m4-12v12"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** Inline SVG pencil icon used on the edit action button. */
const EditIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none">
    <path
      d="M12 20h9"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
    <path
      d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5Z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
  </svg>
);

/** Inline SVG download icon used on the download action button. */
const DownloadIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none">
    <path
      d="M12 3v13m0 0-4-4m4 4 4-4M3 20h18"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** Inline SVG play icon overlaid on video thumbnails. */
const PlayIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
    <path d="M10 8.5v7l6-3.5-6-3.5Z" fill="currentColor" />
  </svg>
);

/**
 * Single photo or video card displayed in the gallery grid.
 *
 * Shows a thumbnail (or video element with poster), an overlay with the event
 * name, date, and owner avatar, and action buttons (delete, edit) that appear
 * on hover or when the card is selected.
 *
 * - Videos render a `<video>` element with a play-icon overlay.
 * - Edit is disabled for videos (video editing is not yet supported).
 * - The selection checkbox is only shown when `canEdit` is true (i.e. the
 *   viewer is the owner).
 */
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

  const thumbSrc = photo.thumbnailUrl || photo.url;
  const dateText = formatDate(photo.takenAt);
  const eventText = photo.eventId || "";

  const nickname = getNickname(photo);
  const avatarLetters = nickname ? initialsFromName(nickname) : null;

  const showMeta = Boolean(eventText || dateText || nickname);
  const showControls = isSelected;

  return (
    <div
      className={
        "group relative overflow-hidden rounded-2xl border bg-neutral-950/40 shadow-sm transition duration-200 " +
        "hover:-translate-y-0.5 hover:border-white/15 hover:shadow-lg " +
        "focus-within:ring-2 focus-within:ring-white/20 " +
        (isSelected
          ? "border-white/25 ring-2 ring-white/20"
          : "border-white/10")
      }
    >
      <button
        type="button"
        onClick={onOpen}
        className="block w-full text-left focus:outline-none"
        aria-label={video ? "Open video" : "Open photo"}
      >
        <div className="relative aspect-square w-full bg-neutral-900/40">
          {video ? (
            <>
              <video
                src={photo.url}
                poster={photo.thumbnailUrl}
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                muted
                playsInline
                preload="metadata"
                crossOrigin="anonymous"
              />
              <div className="absolute inset-0 grid place-items-center">
                <div className="grid h-10 w-10 place-items-center rounded-full bg-black/55 text-white">
                  <PlayIcon />
                </div>
              </div>
            </>
          ) : (
            <img
              src={thumbSrc}
              alt="Family photo"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
              loading="lazy"
              onError={(e) => {
                // CDN thumbnail unavailable (ORB block, missing key, etc.) —
                // fall back to the presigned S3 URL so the card still renders.
                const img = e.currentTarget;
                if (photo.url && img.src !== photo.url) img.src = photo.url;
              }}
            />
          )}

          {showMeta ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-0">
              <div className="bg-gradient-to-t from-black/70 via-black/10 to-transparent px-3 pb-3 pt-10">
                <div className="flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    {eventText ? (
                      <div className="truncate text-xs font-medium text-white/95">
                        {eventText}
                      </div>
                    ) : null}

                    {dateText ? (
                      <div className="text-[11px] text-white/75">
                        {dateText}
                      </div>
                    ) : null}

                    {nickname ? (
                      <div className="mt-1 flex items-center gap-2">
                        <div className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-white/10 bg-white/10 text-[10px] font-semibold text-white/90">
                          {avatarLetters}
                        </div>
                        <div className="truncate text-[11px] text-white/75">
                          {nickname}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {isSelected ? (
                    <div className="text-[11px] text-white/80">Selected</div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </button>

      {canEdit ? (
        <div className="absolute left-2 top-2 z-10">
          <label
            className={
              "flex items-center gap-2 transition " +
              (isSelected
                ? "opacity-100"
                : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100")
            }
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={isSelected}
              onChange={(e) => onToggleSelect(e.target.checked)}
              className="h-5 w-5 cursor-pointer rounded border-neutral-700 bg-neutral-950/60"
              aria-label="Select"
            />
          </label>
        </div>
      ) : null}

      <div
        className={
          "absolute right-2 top-2 z-10 flex gap-2 transition " +
          (showControls
            ? "opacity-100"
            : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100")
        }
        onClick={(e) => e.stopPropagation()}
      >
        {canEdit ? (
          <button
            type="button"
            onClick={() => onDelete()}
            className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-neutral-950/60 text-white backdrop-blur transition hover:bg-neutral-900"
            aria-label="Delete"
            title="Delete"
          >
            <TrashIcon />
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => {
            if (!video) onUpdate();
          }}
          disabled={video}
          className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-neutral-950/60 text-white backdrop-blur transition hover:bg-neutral-900 disabled:opacity-40 disabled:hover:bg-neutral-950/60"
          aria-label="Edit"
          title={video ? "Edit not available for video" : "Edit"}
        >
          <EditIcon />
        </button>

        <button
          type="button"
          onClick={() => downloadPhoto(photo).catch(console.error)}
          className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-neutral-950/60 text-white backdrop-blur transition hover:bg-neutral-900"
          aria-label={photo.archiveKey ? "Download original (HEIC)" : "Download"}
          title={photo.archiveKey ? "Download original (HEIC)" : "Download"}
        >
          <DownloadIcon />
        </button>
      </div>
    </div>
  );
}
