"use client";

import { useEffect, useMemo, useState } from "react";

import EventsGrid, {
  type EventSummary,
} from "@/app/components/events/EventsGrid";
import EmptyState, { EmptyStateIcon } from "@/app/components/ui/EmptyState";
import PhotoUploadModal from "@/app/components/PhotoUploadModal";
import { useProfile } from "@/app/components/ProfileProvider";

type ApiEventsResponse = {
  events?: string[];
  summaries?: EventSummary[];
};

function getUserFromProfileContext(ctx: unknown) {
  const c = ctx as any;
  return c?.user ?? c?.profile ?? c?.me ?? c?.currentUser ?? null;
}

export default function EventsPage() {
  const profileCtx = useProfile() as unknown;
  const user = getUserFromProfileContext(profileCtx);

  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [summaries, setSummaries] = useState<EventSummary[]>([]);

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

  return (
    <div className="space-y-4 lg:space-y-6">
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
        <EventsGrid summaries={summaries} />
      )}
    </div>
  );
}
