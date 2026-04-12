// src/hooks/usePhotoFeed.ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteScroll } from "./useInfiniteScroll";
import type { Photo } from "@/types/photo";

export type { Photo };

type ApiPhotosResponse = {
  photos: Photo[];
  nextCursor: string | null;
};

type Args = {
  pageSize?: number;
  initialEventFilter?: string;
};

function isVideo(p: Photo) {
  if (p.mediaType) return p.mediaType === "video";
  return (p.mimeType ?? "").startsWith("video/");
}

function safeEventId(v: string) {
  const s = (v ?? "").trim();
  if (!s) return "";
  if (s.toLowerCase() === "default") return "";
  return s;
}

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

  const handleUploadSuccess = useCallback(() => {
    setPhotos([]);
    setSelectedKeys([]);
    setHasMore(true);
    setNextCursor(null);
    fetchedCursorsRef.current.clear();
    fetchPage(undefined, serverEventId || undefined, serverMediaFilter || undefined);
    refreshEvents();
  }, [fetchPage, refreshEvents, serverEventId, serverMediaFilter]);

  const updatePhotoUrl = useCallback((key: string, url: string) => {
    setPhotos((prev) => prev.map((p) => (p.key === key ? { ...p, url } : p)));
    setExpandedPhoto((prev) =>
      prev && prev.key === key ? { ...prev, url } : prev
    );
  }, []);

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
