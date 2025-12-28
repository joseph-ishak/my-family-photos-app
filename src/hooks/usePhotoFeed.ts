"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteScroll } from "./useInfiniteScroll"; // adjust if your path differs

export type Photo = {
  key: string; // s3Key
  url: string;
  eventId?: string;
  takenAt?: string;
  ownerUserId?: string;

  // optional if you later switch DELETE to pk/sk (recommended)
  pk?: string;
  sk?: string;
};

type ApiPhotosResponse = {
  photos: Photo[];
  nextCursor: string | null;
};

type Args = {
  pageSize?: number;
};

export function usePhotosFeed({ pageSize = 20 }: Args) {
  // ----- events -----
  const [existingEvents, setExistingEvents] = useState<string[]>([]);

  // ----- feed data -----
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  // ----- UI state -----
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [expandedPhoto, setExpandedPhoto] = useState<Photo | null>(null);

  // ----- filters -----
  const [eventFilter, setEventFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");

  const clearFilters = useCallback(() => {
    setEventFilter("");
    setDateFilter("");
  }, []);

  // ----- infinite scroll wiring -----
  const loaderRef = useRef<HTMLDivElement | null>(null);
  const inFlightRef = useRef(false);

  // prevent fetching the same cursor repeatedly (key fix for “repeating pages”)
  const fetchedCursorsRef = useRef<Set<string>>(new Set());

  const fetchPage = useCallback(
    async (cursor?: string | null) => {
      // cursor === undefined -> first page
      // cursor === null -> no more pages
      if (cursor === null) return;

      const cursorKey = cursor ?? "__FIRST__";

      if (inFlightRef.current) return;
      if (fetchedCursorsRef.current.has(cursorKey)) return;

      inFlightRef.current = true;
      fetchedCursorsRef.current.add(cursorKey);

      try {
        const url =
          cursor && cursor.length > 0
            ? `/api/photos?limit=${pageSize}&cursor=${encodeURIComponent(
                cursor
              )}`
            : `/api/photos?limit=${pageSize}`;

        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to fetch photos: ${res.status}`);

        const data = (await res.json()) as ApiPhotosResponse;

        // merge + de-dupe by key (extra safety)
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
        const more = Boolean(data.nextCursor) && (data.photos?.length ?? 0) > 0;
        setHasMore(more);
      } catch (err) {
        console.error(err);
        setHasMore(false);
      } finally {
        inFlightRef.current = false;
      }
    },
    [pageSize]
  );

  // initial load
  useEffect(() => {
    setPhotos([]);
    setSelectedKeys([]);
    setHasMore(true);
    setNextCursor(null);
    fetchedCursorsRef.current.clear();

    fetchPage(undefined);
  }, [fetchPage]);

  // load more when scrolled
  const loadMore = useCallback(() => {
    if (!hasMore) return;
    if (!nextCursor) return;
    if (inFlightRef.current) return;

    fetchPage(nextCursor);
  }, [fetchPage, hasMore, nextCursor]);

  useInfiniteScroll({
    loaderRef,
    enabled: hasMore,
    canLoadMore: () => !inFlightRef.current && hasMore && Boolean(nextCursor),
    onLoadMore: loadMore,
  });

  // fetch events list
  useEffect(() => {
    refreshEvents();
  }, []);

  const refreshEvents = useCallback(async () => {
    try {
      const r = await fetch("/api/events");
      const d = await r.json();
      const list = Array.isArray(d?.events) ? d.events : [];
      setExistingEvents(list);
    } catch (e) {
      console.error("Failed to refresh events", e);
    }
  }, []);
  // filtered + sorted photos for UI
  const filteredPhotos = useMemo(() => {
    return photos
      .filter((p) =>
        eventFilter
          ? (p.eventId ?? "").toLowerCase().includes(eventFilter.toLowerCase())
          : true
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

  // delete single photo (still uses key-only delete; we can upgrade to pk/sk later)
  const deletePhoto = useCallback(async (key: string, confirmSingle = true) => {
    if (
      confirmSingle &&
      !confirm("Are you sure you want to delete this photo?")
    )
      return;

    const res = await fetch(`/api/photos?key=${encodeURIComponent(key)}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      alert("Delete failed");
      return;
    }

    setPhotos((prev) => prev.filter((p) => p.key !== key));
    setSelectedKeys((prev) => prev.filter((k) => k !== key));
  }, []);

  // bulk delete
  const bulkDelete = useCallback(async () => {
    if (selectedKeys.length === 0) return;
    if (!confirm(`Delete ${selectedKeys.length} selected photos?`)) return;

    // do in parallel
    await Promise.all(selectedKeys.map((k) => deletePhoto(k, false)));

    setSelectedKeys([]);
    // deletePhoto already removes from photos, but this keeps state consistent if any fail
    setPhotos((prev) => prev.filter((p) => !selectedKeys.includes(p.key)));
  }, [selectedKeys, deletePhoto]);

  // when upload succeeds, refresh feed (start over)
  const handleUploadSuccess = useCallback(() => {
    setPhotos([]);
    setSelectedKeys([]);
    setHasMore(true);
    setNextCursor(null);
    fetchedCursorsRef.current.clear();
    fetchPage(undefined);
    refreshEvents(); // ✅ add this line
  }, [fetchPage]);

  return {
    existingEvents,

    selectedKeys,
    setSelectedKeys,

    expandedPhoto,
    setExpandedPhoto,

    eventFilter,
    setEventFilter,

    dateFilter,
    setDateFilter,

    clearFilters,

    filteredPhotos,

    hasMore,
    loaderRef,

    deletePhoto,
    bulkDelete,

    handleUploadSuccess,
  };
}
