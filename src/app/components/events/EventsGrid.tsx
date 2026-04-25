// src/app/components/events/EventsGrid.tsx
"use client";

/**
 * Responsive grid of event cards. Each card links to the event's photo gallery
 * and displays the event's cover image, name, last-updated date, and photo count.
 *
 * An optional `onShare` callback adds a "Share" button overlay to each card so
 * the events page can open the `EventShareModal` without the grid knowing about
 * it.
 */

import Link from "next/link";

export type EventSummary = {
  eventId: string;
  name: string;
  createdAt: string | null;
  updatedAt: string | null;
  photoCount: number;
  coverKey: string | null;
};

const CF_BASE = (process.env.NEXT_PUBLIC_PREVIEWS_CDN_URL || "").replace(
  /\/$/,
  ""
);

/**
 * Formats an ISO 8601 date string as a locale-aware short date.
 * Returns `null` for absent or unparseable values.
 */
function formatDate(value?: string | null) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString();
}

function normalizePreviewKey(key: string) {
  return key.startsWith("previews/") ? key.slice("previews/".length) : key;
}

function buildCoverUrl(coverKey: string | null) {
  if (!coverKey) return null;
  if (!CF_BASE) return null;

  const normalized = normalizePreviewKey(coverKey);
  return `${CF_BASE}/${encodeURI(normalized)}`;
}

export default function EventsGrid({
  summaries,
  onShare,
}: {
  summaries: EventSummary[];
  onShare?: (eventId: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 lg:gap-4 xl:grid-cols-5">
      {summaries.map((ev) => {
        const updated = formatDate(ev.updatedAt);
        const coverUrl = buildCoverUrl(ev.coverKey);

        return (
          <Link
            key={ev.eventId}
            href={`/events/${encodeURIComponent(ev.eventId)}`}
            className="group overflow-hidden rounded-2xl border border-white/10 bg-neutral-950/40 transition hover:border-white/15 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-white/20"
          >
            <div className="relative aspect-square w-full bg-neutral-900/40">
              {coverUrl ? (
                <img
                  src={coverUrl}
                  alt=""
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                  loading="lazy"
                />
              ) : (
                <div className="h-full w-full" />
              )}

              {onShare ? (
                <div className="absolute right-2 top-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onShare(ev.eventId);
                    }}
                    className="rounded-xl border border-white/15 bg-black/45 px-3 py-2 text-xs text-white/90 hover:bg-black/55 transition"
                  >
                    Share
                  </button>
                </div>
              ) : null}

              <div className="pointer-events-none absolute inset-x-0 bottom-0">
                <div className="bg-gradient-to-t from-black/70 via-black/10 to-transparent px-3 pb-3 pt-10">
                  <div className="truncate text-sm font-semibold text-white/90">
                    {ev.name || ev.eventId}
                  </div>

                  <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-white/65">
                    <div className="truncate">
                      {updated ? `Updated ${updated}` : ""}
                    </div>
                    <div className="shrink-0">
                      {typeof ev.photoCount === "number"
                        ? `${ev.photoCount}`
                        : ""}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
