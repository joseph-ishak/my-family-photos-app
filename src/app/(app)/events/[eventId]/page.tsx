// src/app/(app)/events/[eventId]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import FamilyPhotosPage from "@/app/(app)/family-photos/FamilyPhotosPage";
import ContentFrame from "@/app/components/shell/ContentFrame";

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

function formatUpdated(value: string | null) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;

  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const ArrowLeft = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none">
    <path
      d="M15 18l-6-6 6-6"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default function EventDetailPage() {
  const params = useParams();
  const eventId = typeof params?.eventId === "string" ? params.eventId : "";

  const [loadingMeta, setLoadingMeta] = useState(true);
  const [event, setEvent] = useState<EventSummary | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!eventId) return;

      try {
        setLoadingMeta(true);

        const res = await fetch("/api/events", {
          cache: "no-store",
          credentials: "include",
        });

        const data = await res.json().catch(() => ({}));
        const list: EventSummary[] = Array.isArray(data?.summaries)
          ? data.summaries
          : [];

        const found = list.find((e) => e.eventId === eventId) || null;

        if (!cancelled) setEvent(found);
      } finally {
        if (!cancelled) setLoadingMeta(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const coverUrl = useMemo(
    () => buildPreviewUrl(event?.coverKey || null),
    [event?.coverKey]
  );

  const updatedLabel = useMemo(() => {
    return formatUpdated(event?.updatedAt || event?.createdAt || null);
  }, [event?.updatedAt, event?.createdAt]);

  return (
    <ContentFrame mode="media">
      <div className="space-y-4 lg:space-y-6">
        <div className="rounded-3xl border border-neutral-900 bg-neutral-950/40 overflow-hidden">
          <div className="relative">
            <div className="h-40 sm:h-56 bg-neutral-900/40">
              {coverUrl ? (
                <img
                  src={coverUrl}
                  alt={event?.name || eventId}
                  className="h-full w-full object-cover"
                />
              ) : null}
            </div>

            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />

            <div className="absolute left-4 top-4">
              <Link
                href="/events"
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-black/45 px-3 py-2 text-sm text-white/90 hover:bg-black/55 transition"
              >
                <ArrowLeft />
                Events
              </Link>
            </div>

            <div className="absolute inset-x-0 bottom-0 p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-2xl sm:text-3xl font-semibold tracking-tight text-white truncate">
                    {loadingMeta ? "Loading…" : event?.name || eventId}
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-white/75">
                    <span className="rounded-full border border-white/15 bg-black/35 px-2.5 py-1">
                      {event ? `${event.photoCount} items` : " "}
                    </span>
                    {updatedLabel ? (
                      <span className="rounded-full border border-white/15 bg-black/35 px-2.5 py-1">
                        Updated {updatedLabel}
                      </span>
                    ) : null}
                  </div>
                </div>

                <Link
                  href={`/events/${encodeURIComponent(eventId)}?upload=1`}
                  className="inline-flex items-center justify-center rounded-xl bg-neutral-50 px-4 py-3 text-sm font-medium text-neutral-900 hover:opacity-90 transition"
                >
                  Upload
                </Link>
              </div>
            </div>
          </div>
        </div>

        <FamilyPhotosPage initialEventFilter={eventId} hideHeader />
      </div>
    </ContentFrame>
  );
}
