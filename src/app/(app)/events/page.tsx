"use client";

/**
 * Events list page (`/events`).
 *
 * Fetches event summaries from `GET /api/events` and renders them in an
 * `EventsGrid`. An **Upload** button opens `PhotoUploadModal` so users can
 * start a new event or add to an existing one directly from this page.
 *
 * Each event card has a **Share** overlay that opens `EventShareModal` for
 * managing group access without leaving the events list.
 */

import { useEffect, useMemo, useState } from "react";

import EventsGrid, {
  type EventSummary,
} from "@/app/components/events/EventsGrid";
import EmptyState, { EmptyStateIcon } from "@/app/components/ui/EmptyState";
import PhotoUploadModal from "@/app/components/PhotoUploadModal";
import { useProfile } from "@/app/components/ProfileProvider";
import EventShareModal from "@/app/components/events/EventShareModal";

/** Shape of the `/api/events` JSON response. */
type ApiEventsResponse = {
  events?: string[];
  summaries?: EventSummary[];
};

/**
 * Extracts a user object from the `ProfileContext` value.
 * Tries several candidate keys defensively in case the shape changes.
 */
function getUserFromProfileContext(ctx: unknown) {
  const c = ctx as any;
  return c?.user ?? c?.profile ?? c?.me ?? c?.currentUser ?? null;
}

/** Events list page component. */
export default function EventsPage() {
  const profileCtx = useProfile() as unknown;
  const user = getUserFromProfileContext(profileCtx);

  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [summaries, setSummaries] = useState<EventSummary[]>([]);

  const [shareOpen, setShareOpen] = useState(false);
  const [shareEventId, setShareEventId] = useState("");

  /** Fetches the latest event summaries and updates local state. */
  const refresh = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/events", { credentials: "include" });
      const d = (await r.json().catch(() => ({}))) as ApiEventsResponse;

      const list = Array.isArray(d?.summaries) ? d.summaries : [];
      setSummaries(list);
    } catch (e) {
      console.error("Failed to load events", e);
      setSummaries([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const existingEvents = useMemo(
    () => summaries.map((s) => s.eventId),
    [summaries]
  );

  const isEmpty = !loading && summaries.length === 0;

  /** Opens the share modal for the given event. */
  const openShare = (eventId: string) => {
    setShareEventId(eventId);
    setShareOpen(true);
  };

  return (
    <div className="space-y-4 lg:space-y-6">
      <EventShareModal
        open={shareOpen}
        eventId={shareEventId}
        onClose={() => {
          setShareOpen(false);
          setShareEventId("");
        }}
      />

      <div className="flex items-center justify-between gap-3">
        <div className="text-lg font-semibold text-white/90">Events</div>
        <button
          onClick={() => setModalOpen(true)}
          className="rounded-xl bg-neutral-50 px-4 py-2 text-sm font-medium text-neutral-900 hover:opacity-90 transition"
        >
          Upload
        </button>
      </div>

      <PhotoUploadModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onUploadSuccess={() => {
          setModalOpen(false);
          refresh();
        }}
        existingEvents={existingEvents}
        user={user}
      />

      {isEmpty ? (
        <div className="py-10">
          <EmptyState
            icon={<EmptyStateIcon />}
            title="No events yet"
            description="Upload photos to create your first event."
            actionLabel="Upload photos"
            onAction={() => setModalOpen(true)}
          />
        </div>
      ) : loading ? (
        <div className="py-10 text-center text-sm text-neutral-500">
          Loading events
        </div>
      ) : (
        <EventsGrid summaries={summaries} onShare={openShare} />
      )}
    </div>
  );
}
