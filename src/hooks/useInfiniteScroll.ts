"use client";

import { RefObject, useEffect } from "react";

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
  useEffect(() => {
    if (!enabled) return;
    const el = loaderRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        if (canLoadMore && !canLoadMore()) return;
        onLoadMore();
      },
      { threshold: 0, rootMargin: "400px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [loaderRef, enabled, onLoadMore, canLoadMore]);
}
