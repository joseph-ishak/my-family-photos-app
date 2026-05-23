"use client";

import { useEffect, useState } from "react";
import type { Photo } from "../../../types/photo";
import { downloadPhoto } from "@/lib/download";
import { useUploadQueue } from "@/hooks/useUploadQueue";

type Props = {
  photo: Photo;
  canEdit: boolean;
  isSelected: boolean;
  onToggleSelect: (checked: boolean) => void;
  onOpen: () => void;
  onDelete: () => void;
  onUpdate: () => void;
  onSetCover?: () => void;
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

/** Inline SVG retry/refresh icon shown on failed or stuck processing cards. */
const RetryIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none">
    <path
      d="M1 4v6h6"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M3.51 15a9 9 0 1 0 .49-6H1"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** Inline SVG 3-dots (ellipsis) icon for the overflow menu button. */
const DotsIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="5" cy="12" r="1.5" />
    <circle cx="12" cy="12" r="1.5" />
    <circle cx="19" cy="12" r="1.5" />
  </svg>
);

/** Inline SVG play icon overlaid on video thumbnails. */
const PlayIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
    <path d="M10 8.5v7l6-3.5-6-3.5Z" fill="currentColor" />
  </svg>
);

/** SVG ring shown centered on a card while server-side processing is running.
 *
 * The ring has 3 arc segments mapped to upload stages:
 *   0 → 33% : file uploaded to S3 (early commit written)
 *   33→ 66% : queued in Lambda / MediaConvert
 *   66→100% : transcoding complete
 *
 * `segment` (0–3) controls how much of the ring is filled.
 * At segment 2 (stuck waiting for transcoder) the filled arc pulses.
 */
function ProcessingRingOverlay({ segment }: { segment: 0 | 1 | 2 | 3 }) {
  const size = 48;
  const stroke = 4;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const filled = (segment / 3) * circ;
  const isPulsing = segment === 2;

  return (
    <div className="absolute inset-0 grid place-items-center pointer-events-none">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ transform: "rotate(-90deg)" }}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.15)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgb(163,163,163)"
          strokeWidth={stroke}
          strokeDasharray={`${filled} ${circ}`}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.4s ease" }}
          className={isPulsing ? "animate-pulse" : undefined}
        />
      </svg>
    </div>
  );
}

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
 * - Cards with `processingStatus === "processing"` show a progress ring overlay
 *   and are not interactive until processing completes.
 */
export default function PhotoCard({
  photo,
  canEdit,
  isSelected,
  onToggleSelect,
  onOpen,
  onDelete,
  onUpdate,
  onSetCover,
}: Props) {
  const video = isVideo(photo);
  const isProcessing = photo.processingStatus === "processing";
  const isFailed = photo.processingStatus === "failed";

  const { isMediaIdInQueue, retryMedia } = useUploadQueue();

  // retryPending: set true after a successful retry click so the button hides
  // immediately (rather than staying visible while MediaConvert runs).
  // Cleared automatically when processingStatus changes (either to "ready" or
  // back to "failed" if MediaConvert errors again).
  const [retryPending, setRetryPending] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => { setRetryPending(false); }, [photo.processingStatus]);


  // Show retry when stuck/failed AND not actively being processed in this session
  // AND we haven't just clicked retry (retryPending).
  // After a page refresh the queue is empty, so any processing/failed item gets retry.
  const showRetry =
    !retryPending &&
    (isProcessing || isFailed) &&
    !isMediaIdInQueue(photo.mediaId ?? "");

  async function handleRetry() {
    if (isRetrying || !photo.pk || !photo.sk || !photo.mediaId) return;
    setIsRetrying(true);
    try {
      await retryMedia({
        pk: photo.pk,
        sk: photo.sk,
        mediaId: photo.mediaId,
        filename: photo.s3Key?.split("/").pop() ?? photo.sk ?? "video",
        mediaType: video ? "video" : "photo",
        eventId: photo.eventId ?? "",
        takenAt: photo.takenAt,
      });
      // retryMedia shows the tray and adds the item to the queue.
      // isMediaIdInQueue will now return true → showRetry becomes false automatically.
      setRetryPending(true);
    } finally {
      setIsRetrying(false);
    }
  }

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
        (isProcessing || isFailed
          ? "border-white/10 opacity-75 cursor-default"
          : "hover:-translate-y-0.5 hover:border-white/15 hover:shadow-lg " +
            "focus-within:ring-2 focus-within:ring-white/20 " +
            (isSelected ? "border-white/25 ring-2 ring-white/20" : "border-white/10"))
      }
    >
      <button
        type="button"
        onClick={isProcessing || isFailed ? undefined : onOpen}
        disabled={isProcessing || isFailed}
        className="block w-full text-left focus:outline-none disabled:cursor-default"
        aria-label={isProcessing ? "Processing…" : isFailed ? "Processing failed" : video ? "Open video" : "Open photo"}
      >
        <div className="relative aspect-square w-full bg-neutral-900/40">
          {video ? (
            <>
              {photo.thumbnailUrl ? (
                <img
                  src={photo.thumbnailUrl}
                  alt="Video thumbnail"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="h-full w-full bg-neutral-800" />
              )}
              {isProcessing || isFailed ? (
                <ProcessingRingOverlay segment={isFailed ? 1 : 2} />
              ) : (
                <div className="absolute inset-0 grid place-items-center">
                  <div className="grid h-10 w-10 place-items-center rounded-full bg-black/55 text-white">
                    <PlayIcon />
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
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
              {(isProcessing || isFailed) && <ProcessingRingOverlay segment={isFailed ? 1 : 2} />}
            </>
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

      {showRetry && (
        <div className="absolute inset-x-0 bottom-3 z-10 flex justify-center">
          <button
            type="button"
            onClick={handleRetry}
            disabled={isRetrying}
            className="flex items-center gap-1.5 rounded-full border border-white/20 bg-neutral-950/80 px-3 py-1.5 text-xs font-medium text-white backdrop-blur transition hover:bg-neutral-900 disabled:opacity-60"
            title="Retry processing"
          >
            <RetryIcon />
            {isRetrying ? "Retrying…" : isFailed ? "Retry" : "Retry"}
          </button>
        </div>
      )}

      {canEdit && !isProcessing && !isFailed ? (
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

      {!isProcessing && !isFailed && <div
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

        {onSetCover ? (
          <div className="relative">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
              className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-neutral-950/60 text-white backdrop-blur transition hover:bg-neutral-900"
              aria-label="More options"
              title="More options"
            >
              <DotsIcon />
            </button>

            {menuOpen ? (
              <>
                {/* Transparent overlay — clicking outside the dropdown closes it */}
                <div
                  className="fixed inset-0 z-10"
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(false); }}
                />
                <div className="absolute right-0 top-full mt-1 z-20 min-w-[160px] rounded-2xl border border-white/10 bg-neutral-950 shadow-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onSetCover(); setMenuOpen(false); }}
                    className="w-full px-4 py-3 text-left text-sm text-white/90 hover:bg-white/5 transition"
                  >
                    Make Cover Photo
                  </button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>}
    </div>
  );
}
