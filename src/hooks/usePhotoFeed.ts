// src/hooks/usePhotoFeed.ts

/**
 * Core photo-feed hook powering the family-photos gallery.
 *
 * ## Pagination
 * Photos are fetched from `GET /api/photos` using opaque encrypted cursors.
 * A `generationRef` counter is incremented on every filter/event change; any
 * in-flight fetch whose generation doesn't match the current one is silently
 * discarded, preventing stale results from overwriting fresher state (the race
 * condition fixed in March 2026).
 *
 * A `fetchedCursorsRef` set de-duplicates concurrent trigger sources (scroll
 * events, explicit `loadMore` calls) so the same cursor is never fetched twice.
 *
 * ## Filtering
 * - **`eventFilter`** — client-side filter applied to `photo.eventId`. The
 *   value is also sent server-side when the event exists in `existingEvents`,
 *   reducing the payload for scoped galleries.
 * - **`dateFilter`** — client-side prefix match on `photo.takenAt`.
 * - **`mediaFilter`** — sent server-side via `?mediaType=photo|video`.
 *
 * ## Delete flows
 * - Single delete — removes by key from local state after API success.
 * - Bulk delete — removes all selected keys after API success; clears selection.
 *
 * ## Photo editing (two-phase)
 * `saveEditedPhoto` calls `POST /api/photos/request-edit` to get a presigned
 * PUT URL, uploads the blob directly to S3, then calls
 * `POST /api/photos/commit-edit` to update the DynamoDB record and receive a
 * fresh CDN URL for the in-memory photo list.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteScroll } from "./useInfiniteScroll";
import type { Photo } from "@/types/photo";

export type { Photo };

/** Shape of the `GET /api/photos` JSON response. */
type ApiPhotosResponse = {
  photos: Photo[];
  nextCursor: string | null;
};

/** Arguments accepted by `usePhotosFeed`. */
type Args = {
  /** Number of photos to request per page. Defaults to 20. */
  pageSize?: number;
  /**
   * When provided, the feed starts pre-filtered to this event.
   * Changing this prop resets the feed completely.
   */
  initialEventFilter?: string;
};

/**
 * Returns `true` if the photo represents a video.
 * Checks `mediaType` first; falls back to `mimeType` prefix for compatibility.
 */
function isVideo(p: Photo) {
  if (p.mediaType) return p.mediaType === "video";
  return (p.mimeType ?? "").startsWith("video/");
}

/**
 * Normalises an event ID for use in queries and comparisons.
 * Trims whitespace and maps the string `"default"` to `""` (no filter).
 */
function safeEventId(v: string) {
  const s = (v ?? "").trim();
  if (!s) return "";
  if (s.toLowerCase() === "default") return "";
  return s;
}

/**
 * Primary photo-feed hook. Returns paginated, filtered photos and all the
 * callbacks needed to operate the gallery UI.
 *
 * @param pageSize           - Items per page (default 20).
 * @param initialEventFilter - Seed value for the event filter.
 * @returns An object containing photos, filter state, pagination controls,
 *          selection state, and CRUD callbacks.
 */
export function usePhotosFeed({ pageSize = 20, initialEventFilter }: Args) {
  const initialEvent = safeEventId(initialEventFilter ?? "");

  const [existingEvents, setExistingEvents] = useState<string[]>([]);
  const [photoCountByEvent, setPhotoCountByEvent] = useState<Record<string, number>>({});
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  // hasMore means we have a cursor and should keep trying
  const [hasMore, setHasMore] = useState(true);

  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [expandedPhoto, setExpandedPhoto] = useState<Photo | null>(null);

  const [eventFilter, setEventFilter] = useState(initialEvent);
  const [dateFilter, setDateFilter] = useState("");
  const [mediaFilter, setMediaFilter] = useState<"all" | "photo" | "video">("all");

  const clearFilters = useCallback(() => {
    setEventFilter("");
    setDateFilter("");
    setMediaFilter("all");
  }, []);

  const loaderRef = useRef<HTMLDivElement | null>(null);
  const inFlightRef = useRef(false);
  const fetchedCursorsRef = useRef<Set<string>>(new Set());
  // Incremented on every reset to discard results from stale in-flight fetches
  const generationRef = useRef(0);

  /**
   * Fetches the current event list and per-event photo counts from
   * `GET /api/events`. Merges both `summaries[].eventId` and the legacy
   * `events[]` string array for backward compatibility.
   */
  const refreshEvents = useCallback(async () => {
    try {
      const r = await fetch("/api/events", { credentials: "include" });
      const d = await r.json().catch(() => ({}));

      const summaries = Array.isArray(d?.summaries) ? d.summaries : [];
      const idsFromSummaries = summaries
        .map((e: any) =>
          typeof e?.eventId === "string" ? e.eventId.trim() : ""
        )
        .filter(Boolean) as string[];

      const countMap: Record<string, number> = {};
      for (const s of summaries) {
        const id = typeof s?.eventId === "string" ? s.eventId.trim() : "";
        if (id && typeof s?.photoCount === "number") countMap[id] = s.photoCount;
      }
      setPhotoCountByEvent(countMap);

      const events = Array.isArray(d?.events) ? d.events : [];
      const idsFromEvents = events
        .map((v: any) => (typeof v === "string" ? v.trim() : ""))
        .filter(Boolean) as string[];

      const merged = Array.from(
        new Set([...idsFromSummaries, ...idsFromEvents])
      );
      setExistingEvents(merged);
    } catch (e) {
      console.error("Failed to refresh events", e);
    }
  }, []);

  /**
   * Fetches a single page of photos from the API and appends the results to
   * the local `photos` array (de-duplicating by `key`).
   *
   * Guards:
   * - Returns immediately if `cursor === null` (no more pages).
   * - Skips if another fetch is already in-flight (`inFlightRef`).
   * - Skips if this cursor has already been fetched (`fetchedCursorsRef`).
   * - Discards results from stale fetches via `generationRef`.
   *
   * @param cursor            - Opaque pagination cursor, or `undefined` for page 1.
   * @param serverEventId     - Event ID to pass as `?eventId=` query param.
   * @param serverMediaFilter - `"photo"` or `"video"`, or omitted for all.
   */
  const fetchPage = useCallback(
    async (cursor?: string | null, serverEventId?: string, serverMediaFilter?: string) => {
      if (cursor === null) return;

      const currentGen = generationRef.current;
      const cursorKey = `${serverEventId || ""}::${serverMediaFilter || ""}::${cursor ?? "__FIRST__"}`;
      if (inFlightRef.current) return;
      if (fetchedCursorsRef.current.has(cursorKey)) return;

      inFlightRef.current = true;
      fetchedCursorsRef.current.add(cursorKey);

      try {
        const params = new URLSearchParams();
        params.set("limit", String(pageSize));
        if (cursor && cursor.length > 0) params.set("cursor", cursor);
        if (serverEventId) params.set("eventId", serverEventId);
        if (serverMediaFilter) params.set("mediaType", serverMediaFilter);

        const url = `/api/photos?${params.toString()}`;

        const res = await fetch(url, {
          credentials: "include",
          cache: "no-store",
        });

        // Discard results from fetches that started before the last reset
        if (generationRef.current !== currentGen) return;

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          console.error("GET /api/photos failed", res.status, text);
          return;
        }

        const data = (await res.json()) as ApiPhotosResponse;

        // Final generation check before updating state
        if (generationRef.current !== currentGen) return;

        setPhotos((prev) => {
          const seen = new Set(prev.map((p) => p.key));
          const merged = [...prev];
          for (const p of data.photos ?? []) {
            if (!seen.has(p.key)) {
              merged.push(p);
              seen.add(p.key);
            }
          }
          return merged;
        });

        setNextCursor(data.nextCursor ?? null);
        setHasMore(Boolean(data.nextCursor));
      } catch (err) {
        console.error(err);
      } finally {
        // Only release the in-flight lock for the current generation;
        // a stale fetch must not clear the lock for a newer fetch.
        if (generationRef.current === currentGen) {
          inFlightRef.current = false;
        }
      }
    },
    [pageSize]
  );

  const serverEventId = useMemo(() => {
    const v = safeEventId(eventFilter);
    if (!v) return "";
    return existingEvents.includes(v) ? v : "";
  }, [eventFilter, existingEvents]);

  const serverMediaFilter = mediaFilter === "all" ? "" : mediaFilter;

  useEffect(() => {
    const next = safeEventId(initialEventFilter ?? "");
    setEventFilter(next);
    setDateFilter("");
    setMediaFilter("all");
    setSelectedKeys([]);
    setExpandedPhoto(null);
  }, [initialEventFilter]);

  useEffect(() => {
    // Invalidate any in-flight fetch from a previous query context so its
    // result cannot overwrite the state established by this reset.
    generationRef.current += 1;
    inFlightRef.current = false;

    setPhotos([]);
    setSelectedKeys([]);
    setHasMore(true);
    setNextCursor(null);
    fetchedCursorsRef.current.clear();

    fetchPage(undefined, serverEventId || undefined, serverMediaFilter || undefined);
    refreshEvents();
  }, [fetchPage, refreshEvents, serverEventId, serverMediaFilter]);

  // Keep refs to the latest cursor/hasMore so canLoadMore never reads stale
  // state from a closure — particularly important when sparse filtered pages
  // leave the loader visible and the interval fires immediately after a reset.
  const nextCursorRef = useRef(nextCursor);
  const hasMoreRef = useRef(hasMore);
  useEffect(() => { nextCursorRef.current = nextCursor; }, [nextCursor]);
  useEffect(() => { hasMoreRef.current = hasMore; }, [hasMore]);

  /**
   * Triggers the next page load when there is a cursor available and no fetch
   * is already in-flight. Called by the infinite-scroll interval and explicitly
   * by the UI.
   */
  const loadMore = useCallback(() => {
    if (!hasMoreRef.current) return;
    const cursor = nextCursorRef.current;
    if (!cursor) return;
    if (inFlightRef.current) return;
    fetchPage(cursor, serverEventId || undefined, serverMediaFilter || undefined);
  }, [fetchPage, serverEventId, serverMediaFilter]);

  useInfiniteScroll({
    loaderRef,
    enabled: hasMore,
    canLoadMore: () => !inFlightRef.current && hasMoreRef.current && Boolean(nextCursorRef.current),
    onLoadMore: loadMore,
  });

  const filteredPhotos = useMemo(() => {
    const ef = safeEventId(eventFilter).toLowerCase();

    return photos
      .filter((p) =>
        ef ? safeEventId(p.eventId ?? "").toLowerCase() === ef : true
      )
      .filter((p) =>
        dateFilter ? (p.takenAt ?? "").startsWith(dateFilter) : true
      )
      .sort((a, b) => {
        const at = a.takenAt ? new Date(a.takenAt).getTime() : 0;
        const bt = b.takenAt ? new Date(b.takenAt).getTime() : 0;
        return bt - at;
      });
  }, [photos, eventFilter, dateFilter]);

  /**
   * Maps an array of photo keys to the `{ pk, sk, key }` tuples required by
   * the bulk-delete API. Silently drops any keys whose photo record is missing
   * `pk` or `sk` (indicates data integrity issue).
   */
  const buildDeleteItems = useCallback(
    (keys: string[]) => {
      return keys
        .map((k) => {
          const p = photos.find((x) => x.key === k);
          if (!p?.pk || !p?.sk) return null;
          return { pk: p.pk, sk: p.sk, key: p.key };
        })
        .filter((x): x is { pk: string; sk: string; key: string } =>
          Boolean(x)
        );
    },
    [photos]
  );

  /**
   * Sends the `DELETE /api/photos` request for the given items.
   * Shows an alert and returns `false` on network or API error.
   * Returns `true` on success.
   */
  const runDelete = useCallback(
    async (items: { pk: string; sk: string; key: string }[]) => {
      let res: Response;
      try {
        res = await fetch("/api/photos", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ items }),
        });
      } catch (e) {
        console.error("Delete fetch failed", e);
        alert("Delete failed. Network error.");
        return false;
      }

      const text = await res.text().catch(() => "");
      if (!res.ok) {
        let msg = "Delete failed";
        try {
          const data = text ? JSON.parse(text) : {};
          msg = data?.error || msg;
        } catch {
          if (text) msg = text;
        }
        alert(msg);
        return false;
      }

      return true;
    },
    []
  );

  /**
   * Deletes a single photo by key. Removes it from local state and clears it
   * from the selection set on success.
   */
  const deletePhoto = useCallback(
    async (key: string) => {
      const items = buildDeleteItems([key]);

      if (items.length === 0) {
        alert("Delete failed. Missing pk or sk.");
        return;
      }

      const ok = await runDelete(items);
      if (!ok) return;

      setPhotos((prev) => prev.filter((p) => p.key !== key));
      setSelectedKeys((prev) => prev.filter((k) => k !== key));
    },
    [buildDeleteItems, runDelete]
  );

  /**
   * Deletes all currently selected photos in a single API call.
   * Clears the selection and removes the deleted photos from local state on
   * success.
   */
  const bulkDelete = useCallback(async () => {
    if (selectedKeys.length === 0) return;

    const items = buildDeleteItems(selectedKeys);

    if (items.length === 0) {
      alert("Bulk delete failed. Missing pk or sk.");
      return;
    }

    const ok = await runDelete(items);
    if (!ok) return;

    const selected = new Set(selectedKeys);
    setPhotos((prev) => prev.filter((p) => !selected.has(p.key)));
    setSelectedKeys([]);
  }, [buildDeleteItems, runDelete, selectedKeys]);

  /**
   * Called by the upload modal after all files are committed. Resets the photo
   * list and fetches fresh data so newly uploaded photos appear immediately.
   */
  const handleUploadSuccess = useCallback(() => {
    setPhotos([]);
    setSelectedKeys([]);
    setHasMore(true);
    setNextCursor(null);
    fetchedCursorsRef.current.clear();
    fetchPage(undefined, serverEventId || undefined, serverMediaFilter || undefined);
    refreshEvents();
  }, [fetchPage, refreshEvents, serverEventId, serverMediaFilter]);

  /**
   * Updates the in-memory URL for a single photo after a successful edit.
   * Also updates `expandedPhoto` if it is the same photo, so the lightbox
   * immediately shows the edited version.
   */
  const updatePhotoUrl = useCallback((key: string, url: string) => {
    setPhotos((prev) => prev.map((p) => (p.key === key ? { ...p, url } : p)));
    setExpandedPhoto((prev) =>
      prev && prev.key === key ? { ...prev, url } : prev
    );
  }, []);

  /**
   * Two-phase photo edit save:
   * 1. `POST /api/photos/request-edit` — gets a presigned S3 PUT URL.
   * 2. S3 PUT — uploads the edited image blob directly.
   * 3. `POST /api/photos/commit-edit` — updates the DynamoDB record and returns
   *    a fresh CDN URL that is written back to the in-memory photo list.
   *
   * Videos are rejected with an alert (not yet supported).
   * Missing `pk`/`sk`/`s3Key` fields are treated as a data error and abort.
   */
  const saveEditedPhoto = useCallback(
    async (photo: Photo, blob: Blob) => {
      if (isVideo(photo)) {
        alert("Video editing is not supported yet.");
        return;
      }

      const pk = photo.pk;
      const sk = photo.sk;
      const s3Key = photo.s3Key || photo.key;
      const filetype = blob.type || photo.mimeType || "image/jpeg";

      if (!pk || !sk || !s3Key) {
        alert("Update failed. Missing pk or sk.");
        return;
      }

      const r1 = await fetch("/api/photos/request-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ pk, sk, s3Key, filetype }),
      });

      if (!r1.ok) {
        const t = await r1.text().catch(() => "");
        alert(t || "Update failed.");
        return;
      }

      const d1 = (await r1.json()) as { signedUrl: string };

      const put = await fetch(d1.signedUrl, {
        method: "PUT",
        headers: { "Content-Type": filetype },
        body: blob,
      });

      if (!put.ok) {
        const t = await put.text().catch(() => "");
        alert(t || "Upload failed.");
        return;
      }

      const r2 = await fetch("/api/photos/commit-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ pk, sk, s3Key, filetype }),
      });

      if (!r2.ok) {
        const t = await r2.text().catch(() => "");
        alert(t || "Commit failed.");
        return;
      }

      const d2 = (await r2.json()) as { url: string };
      if (d2?.url) updatePhotoUrl(photo.key, d2.url);
    },
    [updatePhotoUrl]
  );

  const totalForCurrentEvent: number | null =
    serverEventId ? (photoCountByEvent[serverEventId] ?? null) : null;

  // Keep a ref so the polling interval always sees the latest photos without
  // causing the interval effect to re-subscribe on every render.
  const photosRef = useRef<Photo[]>([]);
  useEffect(() => { photosRef.current = photos; }, [photos]);

  // Poll every 15 s for photos that are still server-side processing.
  // Only active when at least one photo has processingStatus === "processing".
  useEffect(() => {
    const PROCESSING_POLL_MS = 15_000;

    const id = setInterval(async () => {
      const pending = photosRef.current.filter(
        (p) => (p.processingStatus === "processing" || p.processingStatus === "failed") && p.pk && p.sk
      );
      if (pending.length === 0) return;

      await Promise.all(
        pending.map(async (p) => {
          try {
            const res = await fetch("/api/media/status", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ pk: p.pk, sk: p.sk }),
            });
            if (!res.ok) return;
            const data = await res.json() as { exists: boolean; processingStatus: "processing" | "ready" | "failed" | null };
            if (data.processingStatus === "ready" || data.processingStatus === "failed") {
              setPhotos((prev) =>
                prev.map((photo) =>
                  photo.key === p.key
                    ? { ...photo, processingStatus: data.processingStatus as "ready" | "failed" }
                    : photo
                )
              );
            }
          } catch {
            // Swallow — transient errors don't need to surface to the user
          }
        })
      );
    }, PROCESSING_POLL_MS);

    return () => clearInterval(id);
  }, []); // Mount-only: reads from photosRef ref, no dependencies needed

  return {
    existingEvents,
    totalForCurrentEvent,

    selectedKeys,
    setSelectedKeys,

    expandedPhoto,
    setExpandedPhoto,

    eventFilter,
    setEventFilter,

    dateFilter,
    setDateFilter,

    mediaFilter,
    setMediaFilter,

    clearFilters,

    filteredPhotos,

    hasMore,
    loadMore,
    loaderRef,

    deletePhoto,
    bulkDelete,

    handleUploadSuccess,

    saveEditedPhoto,
  };
}
