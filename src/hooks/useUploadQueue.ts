"use client";

/**
 * Consumer hook for the global upload queue context.
 *
 * Usage:
 *   const { enqueueFiles, queue, isVisible, togglePanel } = useUploadQueue();
 *
 * Must be called inside a component that is a descendant of UploadQueueProvider
 * (which wraps the entire authenticated layout).
 */

import { useUploadQueueContext } from "@/app/components/upload/UploadQueueProvider";

export function useUploadQueue() {
  return useUploadQueueContext();
}
