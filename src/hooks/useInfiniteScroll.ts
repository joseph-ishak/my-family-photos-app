"use client";

/**
 * Attaches an `IntersectionObserver` to a loader sentinel element and fires
 * `onLoadMore` whenever the sentinel enters the viewport.
 *
 * A polling interval (400 ms) keeps firing while the sentinel stays visible,
 * which handles the case where a single page of results does not fill the
 * viewport and more pages need to be loaded back-to-back.
 *
 * The `canLoadMore` guard prevents redundant fetches while an in-flight request
 * is already pending. Both `onLoadMore` and `canLoadMore` are stored in refs so
 * the observer closure always calls the latest version without needing to be
 * re-registered on every render.
 */

import { RefObject, useEffect, useRef } from "react";

/** Configuration options for `useInfiniteScroll`. */
type Args = {
  /** Ref attached to the sentinel element at the bottom of the list. */
  loaderRef: RefObject<Element | null>;
  /** When `false` the observer is disconnected and polling stops immediately. */
  enabled: boolean;
  /** Called each time the sentinel is intersecting and `canLoadMore` returns true. */
  onLoadMore: () => void;
  /**
   * Optional guard that returns `false` to suppress a load-more call — e.g.
   * while an in-flight fetch is in progress. When omitted, every intersection
   * event triggers `onLoadMore`.
   */
  canLoadMore?: () => boolean;
};

/**
 * Registers an `IntersectionObserver` on `loaderRef.current` and calls
 * `onLoadMore` when the element enters the viewport (plus on a 400 ms polling
 * interval while it stays visible).
 *
 * Cleans up the observer and interval automatically when `enabled` changes to
 * `false` or the component unmounts.
 */
export function useInfiniteScroll({
  loaderRef,
  enabled,
  onLoadMore,
  canLoadMore,
}: Args) {
  const onLoadMoreRef = useRef(onLoadMore);
  const canLoadMoreRef = useRef(canLoadMore);

  const isIntersectingRef = useRef(false);
  const intervalIdRef = useRef<number | null>(null);

  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  }, [onLoadMore]);

  useEffect(() => {
    canLoadMoreRef.current = canLoadMore;
  }, [canLoadMore]);

  useEffect(() => {
    if (!enabled) {
      isIntersectingRef.current = false;

      if (intervalIdRef.current !== null) {
        window.clearInterval(intervalIdRef.current);
        intervalIdRef.current = null;
      }

      return;
    }

    let cancelled = false;
    let observer: IntersectionObserver | null = null;
    let retryTimer: number | null = null;

    /** Clears the polling interval if one is running. */
    const stopInterval = () => {
      if (intervalIdRef.current !== null) {
        window.clearInterval(intervalIdRef.current);
        intervalIdRef.current = null;
      }
    };

    /** Starts a 400 ms polling interval that calls `onLoadMore` while intersecting. */
    const startInterval = () => {
      if (intervalIdRef.current !== null) return;

      intervalIdRef.current = window.setInterval(() => {
        if (cancelled) return;
        if (!isIntersectingRef.current) return;

        const can = canLoadMoreRef.current;
        const allowed = can ? can() : true;
        if (!allowed) return;

        onLoadMoreRef.current();
      }, 400);
    };

    /**
     * Creates the `IntersectionObserver` and attaches it to `loaderRef.current`.
     * Retries every 100 ms if the element is not yet in the DOM.
     */
    const attach = () => {
      if (cancelled) return;

      const el = loaderRef.current;
      if (!el) {
        retryTimer = window.setTimeout(attach, 100);
        return;
      }

      observer = new IntersectionObserver(
        (entries) => {
          const first = entries[0];
          const intersecting = Boolean(first?.isIntersecting);

          isIntersectingRef.current = intersecting;

          if (!intersecting) {
            stopInterval();
            return;
          }

          const can = canLoadMoreRef.current;
          const allowed = can ? can() : true;
          if (!allowed) return;

          onLoadMoreRef.current();
          startInterval();
        },
        { threshold: 0, rootMargin: "400px" }
      );

      observer.observe(el);
    };

    attach();

    return () => {
      cancelled = true;

      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }

      stopInterval();

      try {
        observer?.disconnect();
      } catch {}

      observer = null;
    };
  }, [enabled, loaderRef]);
}
