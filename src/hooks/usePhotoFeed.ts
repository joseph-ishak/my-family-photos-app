"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteScroll } from "./useInfiniteScroll";

export type Photo = {
  key: string;
  url: string;
  eventId?: string;
  takenAt?: string;
  ownerUserId?: string;
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
  const [existingEvents, setExistingEvents] = useState<string[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [expandedPhoto, setExpandedPhoto] = useState<Photo | null>(null);

  const [eventFilter, setEventFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");

  const clearFilters = useCallback(() => {
    setEventFilter("");
    setDateFilter("");
  }, []);

  const loaderRef = useRef<HTMLDivElement | null>(null);
  const inFlightRef = useRef(false);
  const fetchedCursorsRef = useRef<Set<string>>(new Set());

  const refreshEvents = useCallback(async () => {
    try {
      const r = await fetch("/api/events", { credentials: "include" });
      const d = await r.json().catch(() => ({}));
      const list = Array.isArray(d?.events) ? d.events : [];
      setExistingEvents(list);
    } catch (e) {
      console.error("Failed to refresh events", e);
    }
  }, []);

  const fetchPage = useCallback(
    async (cursor?: string | null) => {
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

        const res = await fetch(url, {
          credentials: "include",
          cache: "no-store",
        });

        if (!res.ok) throw new Error(`Failed to fetch photos: ${res.status}`);

        const data = (await res.json()) as ApiPhotosResponse;

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

  useEffect(() => {
    setPhotos([]);
    setSelectedKeys([]);
    setHasMore(true);
    setNextCursor(null);
    fetchedCursorsRef.current.clear();

    fetchPage(undefined);
    refreshEvents();
  }, [fetchPage, refreshEvents]);

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
    fetchPage(undefined);
    refreshEvents();
  }, [fetchPage, refreshEvents]);

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
