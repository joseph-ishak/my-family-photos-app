"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type EventSummary = {
  eventId: string;
  name: string;
  createdAt: string | null;
  updatedAt: string | null;
  photoCount: number;
  coverKey: string | null;
};

function toPreviewPath(key: string) {
  if (key.startsWith("previews/")) return key.slice("previews/".length);
  if (key.startsWith("uploads/")) return key.slice("uploads/".length);
  return key;
}

function buildPreviewUrl(key: string | null) {
  if (!key) return null;

  const base = process.env.NEXT_PUBLIC_PREVIEWS_CDN_URL;
  if (!base) return null;

  const rel = toPreviewPath(key);
  return new URL(rel, base.endsWith("/") ? base : base + "/").toString();
}

export default function EventsPage() {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        setLoading(true);
        const res = await fetch("/api/events", {
          cache: "no-store",
          credentials: "include",
        });

        const data = await res.json().catch(() => ({}));
        const list = Array.isArray(data?.summaries) ? data.summaries : [];

        if (!cancelled) setEvents(list);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const eventsWithCover = useMemo(() => {
    return events.map((e) => ({
      ...e,
      coverUrl: buildPreviewUrl(e.coverKey),
    }));
  }, [events]);

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Events</h1>
      </div>

      {loading ? (
        <div>Loading…</div>
      ) : eventsWithCover.length === 0 ? (
        <div>No events yet.</div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {eventsWithCover.map((e) => (
            <Link
              key={e.eventId}
              href={`/events/${encodeURIComponent(e.eventId)}`}
              className="rounded-xl border p-3 hover:bg-neutral-50"
            >
              <div className="mb-2 aspect-square w-full overflow-hidden rounded-lg bg-neutral-100 flex items-center justify-center">
                {e.coverUrl ? (
                  <img
                    src={e.coverUrl}
                    alt={e.name}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="text-xs text-neutral-500 px-2 text-center">
                    No cover yet
                  </div>
                )}
              </div>

              <div className="text-sm font-medium">{e.name}</div>
              <div className="text-xs text-neutral-600">
                {e.photoCount} items
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
