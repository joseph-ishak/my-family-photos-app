"use client";

import { RefObject, useEffect, useRef } from "react";

type Args = {
  loaderRef: RefObject<Element | null>;
  enabled: boolean;
  onLoadMore: () => void;
  canLoadMore?: () => boolean;
};

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

    const stopInterval = () => {
      if (intervalIdRef.current !== null) {
        window.clearInterval(intervalIdRef.current);
        intervalIdRef.current = null;
      }
    };

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
