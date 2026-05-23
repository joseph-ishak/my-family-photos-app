"use client";

/**
 * Global background upload queue.
 *
 * Manages the complete lifecycle for every file from the moment the user picks
 * it to the moment the DynamoDB record is confirmed. All upload logic that
 * previously lived in PhotoUploadModal is here, running independently of any
 * modal or page component.
 *
 * Architecture:
 *  - `useReducer` holds per-file state (stage, cached blobs/keys, errors).
 *  - A `useEffect([queue])` acts as the scheduler: whenever queue state
 *    changes it fills open concurrency slots with new workers.
 *  - `processingRef` (a Set of fileIds) prevents double-starting a worker for
 *    the same file when the effect re-fires during in-flight work.
 *  - A single mount-time `setInterval` polls /api/media/status for HEIC/video
 *    files waiting on Lambda processing. It reads `queueRef` to avoid stale
 *    closures.
 *
 * When any file reaches "done", a `CustomEvent("upload:complete")` is
 * dispatched on `window` so gallery pages can refresh without prop threading.
 */

import React, { createContext, useContext, useEffect, useReducer, useRef } from "react";
import type {
  UploadFileStatus,
  UploadQueueAction,
  UploadQueueState,
  UploadStage,
} from "@/types/upload";

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_PREPARE_CONCURRENCY = 4;
const MAX_UPLOAD_CONCURRENCY = 3;
const POLL_INTERVAL_MS = 3000;

const UPLOAD_ACTIVE_STAGES: UploadStage[] = [
  "requesting_url",
  "uploading_preview",
  "uploading_original",
  "committing",
  "queued_processing",
];

// ─── Reducer ─────────────────────────────────────────────────────────────────

function reducer(
  state: UploadQueueState,
  action: UploadQueueAction
): UploadQueueState {
  switch (action.type) {
    case "ENQUEUE":
      return {
        ...state,
        queue: [...state.queue, ...action.items],
        isVisible: true,
        isPanelOpen: true,
      };

    case "PATCH": {
      const queue = state.queue.map((item) =>
        item.fileId === action.fileId ? { ...item, ...action.patch } : item
      );
      return { ...state, queue };
    }

    case "FAIL": {
      const queue = state.queue.map((item) =>
        item.fileId === action.fileId
          ? {
              ...item,
              stage: "failed" as UploadStage,
              errorStage: action.errorStage,
              errorMessage: action.errorMessage,
            }
          : item
      );
      return { ...state, queue };
    }

    case "SUCCEED": {
      const queue = state.queue.map((item) =>
        item.fileId === action.fileId
          ? { ...item, stage: "done" as UploadStage }
          : item
      );
      return { ...state, queue };
    }

    case "RETRY": {
      const item = state.queue.find((f) => f.fileId === action.fileId);
      if (!item || item.stage !== "failed") return state;

      const retryFromPrepare = item.errorStage === "preparing";
      const retryStage: UploadStage = retryFromPrepare ? "idle" : "requesting_url";

      const queue = state.queue.map((f) =>
        f.fileId === action.fileId
          ? {
              ...f,
              stage: retryStage,
              errorStage: undefined,
              errorMessage: undefined,
              retryCount: f.retryCount + 1,
              // On prepare retry: clear everything.
              // On upload retry: keep preparedBlob (expensive to regenerate);
              //   clear all server-assigned IDs so we get a fresh presigned URL.
              preparedBlob: retryFromPrepare ? undefined : f.preparedBlob,
              previewS3Key: undefined,
              originalS3Key: undefined,
              incomingS3Key: undefined,
              mediaId: undefined,
              sk: undefined,
              takenAt: undefined,
              safeName: undefined,
              committedEventId: undefined,
              pk: undefined,
            }
          : f
      );
      return { ...state, queue };
    }

    case "DISMISS_DONE": {
      const queue = state.queue.filter(
        (f) => f.stage !== "done" && f.stage !== "skipped"
      );
      return { ...state, queue, isVisible: queue.length > 0 };
    }

    case "TOGGLE_PANEL":
      return { ...state, isPanelOpen: !state.isPanelOpen };

    case "SHOW":
      return { ...state, isVisible: true };

    default:
      return state;
  }
}

const initialState: UploadQueueState = {
  queue: [],
  isVisible: false,
  isPanelOpen: false,
};

// ─── Context ─────────────────────────────────────────────────────────────────

export type UploadQueueContextValue = {
  queue: UploadFileStatus[];
  isVisible: boolean;
  isPanelOpen: boolean;
  enqueueFiles: (files: File[], eventId: string, userId: string) => void;
  retryFile: (fileId: string) => void;
  dismissCompleted: () => void;
  togglePanel: () => void;
  /** Returns true if a media item is actively being processed in the current queue session. */
  isMediaIdInQueue: (mediaId: string) => boolean;
  /**
   * Retries server-side processing for a media item already committed to DynamoDB.
   * Calls /api/media/retry-processing, then adds a pre-seeded "processing" queue
   * item so the upload tray shows progress and the poll detects completion.
   */
  retryMedia: (photo: {
    pk: string;
    sk: string;
    mediaId: string;
    filename: string;
    mediaType: "photo" | "video";
    eventId: string;
    takenAt?: string;
  }) => Promise<void>;
};

const UploadQueueContext = createContext<UploadQueueContextValue | null>(null);

export function useUploadQueueContext(): UploadQueueContextValue {
  const ctx = useContext(UploadQueueContext);
  if (!ctx) throw new Error("useUploadQueueContext must be inside UploadQueueProvider");
  return ctx;
}

// ─── File-type helpers ────────────────────────────────────────────────────────

function isVideoFile(file: File) {
  return file.type.startsWith("video/");
}

function isImageFile(file: File) {
  return file.type.startsWith("image/");
}

function isHeicOrHeif(file: File) {
  const type = (file.type || "").toLowerCase();
  const name = (file.name || "").toLowerCase();
  return (
    type === "image/heic" ||
    type === "image/heif" ||
    name.endsWith(".heic") ||
    name.endsWith(".heif")
  );
}

const VIDEO_EXTENSIONS = [".mov", ".mp4", ".m4v", ".avi", ".mkv", ".webm"];

function isVideoByExtension(file: File) {
  const name = (file.name || "").toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export function isSupportedFile(file: File) {
  return (
    isImageFile(file) ||
    isVideoFile(file) ||
    isHeicOrHeif(file) ||
    isVideoByExtension(file)
  );
}

// ─── Canvas helpers (browser-only) ───────────────────────────────────────────

async function imageFileToPreviewBlob(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Image load failed"));
      img.src = url;
    });
    const maxSide = 1200;
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const outW = Math.max(1, Math.round(w * scale));
    const outH = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas context missing");
    ctx.drawImage(img, 0, 0, outW, outH);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Preview encode failed"))),
        "image/jpeg",
        0.78
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Attempts to generate a JPEG preview for a HEIC file using `createImageBitmap`.
 * Works on Chrome and Safari; silently returns `undefined` on Firefox or when
 * the browser doesn't support HEIC decoding.
 */
async function heicToPreviewBlobOptional(file: File): Promise<Blob | undefined> {
  try {
    const bitmap = await createImageBitmap(file);
    const maxSide = 1200;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) { bitmap.close(); return undefined; }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("encode failed"))),
        "image/jpeg",
        0.78
      );
    });
  } catch {
    return undefined;
  }
}

async function videoFileToPosterBlob(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.src = url;

    await new Promise<void>((resolve, reject) => {
      let gotMeta = false;
      let gotData = false;
      const tryResolve = () => {
        if (gotMeta && gotData) {
          cleanup();
          resolve();
        }
      };
      const onMeta = () => { gotMeta = true; tryResolve(); };
      const onData = () => { gotData = true; tryResolve(); };
      const onError = () => { cleanup(); reject(new Error("Video load failed")); };
      const cleanup = () => {
        video.removeEventListener("loadedmetadata", onMeta);
        video.removeEventListener("loadeddata", onData);
        video.removeEventListener("error", onError);
      };
      video.addEventListener("loadedmetadata", onMeta);
      video.addEventListener("loadeddata", onData);
      video.addEventListener("error", onError);
    });

    const targetTime = Math.min(0.2, Math.max(0, (video.duration || 0) * 0.05));
    await new Promise<void>((resolve, reject) => {
      const onSeeked = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new Error("Video seek failed")); };
      const cleanup = () => {
        video.removeEventListener("seeked", onSeeked);
        video.removeEventListener("error", onError);
      };
      video.addEventListener("seeked", onSeeked);
      video.addEventListener("error", onError);
      try {
        video.currentTime = targetTime;
      } catch {
        cleanup();
        reject(new Error("Seek failed"));
      }
    });

    const vw = video.videoWidth || 0;
    const vh = video.videoHeight || 0;
    if (!vw || !vh) throw new Error("Video dimensions missing");
    const maxSide = 1200;
    const scale = Math.min(1, maxSide / Math.max(vw, vh));
    const outW = Math.max(1, Math.round(vw * scale));
    const outH = Math.max(1, Math.round(vh * scale));
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas context missing");
    ctx.drawImage(video, 0, 0, outW, outH);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Poster encode failed"))),
        "image/jpeg",
        0.8
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ─── Network helpers ──────────────────────────────────────────────────────────

async function requestSignedUrl(args: {
  filename: string;
  filetype: string;
  userId: string;
  eventId: string;
  mediaType: "photo" | "video";
  kind: "preview" | "original" | "archive" | "incoming";
  thumbnailKey?: string;
  mediaId?: string;
}) {
  const res = await fetch("/api/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`upload-url failed: ${res.status}`);
  return res.json() as Promise<{
    signedUrl: string;
    s3Key: string;
    mediaId?: string;
    sk?: string;
    takenAt?: string;
    filename?: string;
    eventId?: string;
  }>;
}

async function putToS3(signedUrl: string, contentType: string, body: Blob) {
  const res = await fetch(signedUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body,
  });
  if (!res.ok) throw new Error(`S3 PUT failed: ${res.status}`);
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function UploadQueueProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Tracks fileIds that currently have an active async worker running.
  // This prevents the scheduler from double-starting a worker for the same
  // file when the queue effect re-fires mid-flight.
  const processingRef = useRef<Set<string>>(new Set());

  // Always-fresh queue snapshot for the polling interval closure.
  const queueRef = useRef<UploadFileStatus[]>([]);
  useEffect(() => {
    queueRef.current = state.queue;
  }, [state.queue]);

  // ── Prepare worker ────────────────────────────────────────────────────────

  async function runPrepare(item: UploadFileStatus) {
    dispatch({ type: "PATCH", fileId: item.fileId, patch: { stage: "preparing" } });

    try {
      let preparedBlob: Blob | undefined;

      if (item.isVideo) {
        try {
          preparedBlob = await videoFileToPosterBlob(item.file);
        } catch {
          // Poster generation is non-fatal for videos — upload continues without one.
        }
      } else if (item.isHeic) {
        // Try browser HEIC decoding (Chrome/Safari). Non-fatal — Lambda handles
        // the real conversion; this only provides an early-commit thumbnail.
        preparedBlob = await heicToPreviewBlobOptional(item.file);
      } else {
        // Non-HEIC photos: generate preview thumbnail (fatal if this fails).
        preparedBlob = await imageFileToPreviewBlob(item.file);
      }

      dispatch({
        type: "PATCH",
        fileId: item.fileId,
        patch: { stage: "requesting_url", preparedBlob },
      });
    } catch (err: any) {
      dispatch({
        type: "FAIL",
        fileId: item.fileId,
        errorStage: "preparing",
        errorMessage: err?.message ?? "Preparation failed",
      });
    } finally {
      processingRef.current.delete(item.fileId);
    }
  }

  // ── Upload worker ─────────────────────────────────────────────────────────

  async function runUpload(item: UploadFileStatus) {
    const { fileId, file, eventId, userId, isHeic, isVideo, preparedBlob } = item;
    // Track the current stage locally so catch can report the right failed stage.
    let currentStage: UploadStage = "requesting_url";

    try {
      // ── Lambda path (HEIC or video) ─────────────────────────────────────
      if (isHeic || isVideo) {
        const fileType = isVideo
          ? file.type || "video/quicktime"
          : file.type || "image/heic";
        const processEndpoint = isVideo
          ? "/api/media/process-video"
          : "/api/media/process";

        // Upload preview/poster if the blob exists (non-fatal skip if absent).
        let thumbnailKey: string | undefined;
        if (preparedBlob) {
          currentStage = "uploading_preview";
          dispatch({ type: "PATCH", fileId, patch: { stage: "uploading_preview" } });
          const previewResp = await requestSignedUrl({
            filename: "preview.jpg",
            filetype: "image/jpeg",
            userId,
            eventId,
            mediaType: isVideo ? "video" : "photo",
            kind: "preview",
          });
          await putToS3(previewResp.signedUrl, "image/jpeg", preparedBlob);
          thumbnailKey = previewResp.s3Key;
          dispatch({ type: "PATCH", fileId, patch: { previewS3Key: previewResp.s3Key } });
        }

        // Upload raw file to incoming/.
        currentStage = "uploading_original";
        dispatch({ type: "PATCH", fileId, patch: { stage: "uploading_original" } });
        const incomingResp = await requestSignedUrl({
          filename: file.name,
          filetype: fileType,
          userId,
          eventId,
          mediaType: isVideo ? "video" : "photo",
          kind: "incoming",
          thumbnailKey,
        });
        const {
          mediaId,
          sk,
          takenAt,
          filename: safeName,
          eventId: committedEventId,
        } = incomingResp;
        if (!mediaId || !sk || !takenAt || !safeName || !committedEventId) {
          throw new Error("upload-url response missing commit fields");
        }
        dispatch({
          type: "PATCH",
          fileId,
          patch: {
            mediaId,
            sk,
            takenAt,
            safeName,
            committedEventId,
            incomingS3Key: incomingResp.s3Key,
          },
        });
        await putToS3(incomingResp.signedUrl, fileType, file);

        // Early commit — write a "processing" stub to DynamoDB immediately so
        // the gallery card appears with a processing ring before Lambda finishes.
        currentStage = "committing";
        dispatch({ type: "PATCH", fileId, patch: { stage: "committing" } });
        const earlyCommitRes = await fetch("/api/media/commit", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mediaId,
            sk,
            s3Key: incomingResp.s3Key,
            incomingKey: incomingResp.s3Key, // Persisted separately so retry can re-submit after s3Key is overwritten by completion Lambda
            eventId: committedEventId,
            takenAt,
            mimeType: fileType,
            filename: safeName,
            mediaType: isVideo ? "video" : "photo",
            ...(thumbnailKey ? { thumbnailKey } : {}),
            processingStatus: "processing",
          }),
        });
        if (!earlyCommitRes.ok) {
          // Non-fatal: Lambda completion will write the final record anyway.
          console.warn("Early commit failed:", earlyCommitRes.status);
        }

        // Invoke Lambda to process the raw file.
        currentStage = "queued_processing";
        dispatch({ type: "PATCH", fileId, patch: { stage: "queued_processing" } });
        const processRes = await fetch(processEndpoint, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mediaId,
            sk,
            incomingKey: incomingResp.s3Key,
            eventId: committedEventId,
            takenAt,
            filename: safeName,
          }),
        });
        if (!processRes.ok) {
          throw new Error(`process trigger failed: ${processRes.status}`);
        }

        const pk = `EVENT#${committedEventId}`;
        dispatch({
          type: "PATCH",
          fileId,
          patch: { pk, stage: "processing" },
        });

        // Polling is handled by the shared interval — worker is done here.
        processingRef.current.delete(fileId);
        return;
      }

      // ── Direct path (non-HEIC, non-video photo) ─────────────────────────

      let thumbnailKey: string | undefined;

      if (preparedBlob) {
        currentStage = "uploading_preview";
        dispatch({ type: "PATCH", fileId, patch: { stage: "uploading_preview" } });
        const previewResp = await requestSignedUrl({
          filename: "preview.jpg",
          filetype: "image/jpeg",
          userId,
          eventId,
          mediaType: "photo",
          kind: "preview",
        });
        await putToS3(previewResp.signedUrl, "image/jpeg", preparedBlob);
        thumbnailKey = previewResp.s3Key;
        dispatch({ type: "PATCH", fileId, patch: { previewS3Key: previewResp.s3Key } });
      }

      currentStage = "uploading_original";
      dispatch({ type: "PATCH", fileId, patch: { stage: "uploading_original" } });
      const mimeType = file.type || "application/octet-stream";
      const originalResp = await requestSignedUrl({
        filename: file.name,
        filetype: mimeType,
        userId,
        eventId,
        mediaType: "photo",
        kind: "original",
        thumbnailKey,
      });
      const {
        mediaId,
        sk,
        takenAt,
        filename: safeName,
        eventId: committedEventId,
      } = originalResp;
      if (!mediaId || !sk || !takenAt || !safeName || !committedEventId) {
        throw new Error("upload-url response missing commit fields");
      }
      dispatch({
        type: "PATCH",
        fileId,
        patch: {
          mediaId,
          sk,
          takenAt,
          safeName,
          committedEventId,
          originalS3Key: originalResp.s3Key,
        },
      });
      await putToS3(originalResp.signedUrl, mimeType, file);

      currentStage = "committing";
      dispatch({ type: "PATCH", fileId, patch: { stage: "committing" } });
      const commitRes = await fetch("/api/media/commit", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaId,
          sk,
          s3Key: originalResp.s3Key,
          eventId: committedEventId,
          takenAt,
          mimeType,
          filename: safeName,
          mediaType: "photo",
          thumbnailKey,
        }),
      });
      if (!commitRes.ok) throw new Error(`commit failed: ${commitRes.status}`);

      dispatch({ type: "SUCCEED", fileId });
      window.dispatchEvent(
        new CustomEvent("upload:complete", {
          detail: { eventId: committedEventId, mediaId, mediaType: "photo" },
        })
      );
    } catch (err: any) {
      dispatch({
        type: "FAIL",
        fileId,
        errorStage: currentStage,
        errorMessage: err?.message ?? "Upload failed",
      });
    } finally {
      processingRef.current.delete(fileId);
    }
  }

  // ── Scheduler ─────────────────────────────────────────────────────────────
  // Fires whenever queue changes. Fills open concurrency slots.

  useEffect(() => {
    const queue = state.queue;

    // Prepare pool
    const activePrepareCount = queue.filter(
      (f) =>
        processingRef.current.has(f.fileId) &&
        (f.stage === "idle" || f.stage === "preparing")
    ).length;
    const prepareSlots = Math.max(0, MAX_PREPARE_CONCURRENCY - activePrepareCount);
    const idleFiles = queue.filter(
      (f) => f.stage === "idle" && !processingRef.current.has(f.fileId)
    );
    idleFiles.slice(0, prepareSlots).forEach((f) => {
      processingRef.current.add(f.fileId);
      runPrepare(f);
    });

    // Upload pool
    const activeUploadCount = queue.filter(
      (f) =>
        processingRef.current.has(f.fileId) &&
        UPLOAD_ACTIVE_STAGES.includes(f.stage)
    ).length;
    const uploadSlots = Math.max(0, MAX_UPLOAD_CONCURRENCY - activeUploadCount);
    const pendingUpload = queue.filter(
      (f) => f.stage === "requesting_url" && !processingRef.current.has(f.fileId)
    );
    pendingUpload.slice(0, uploadSlots).forEach((f) => {
      processingRef.current.add(f.fileId);
      runUpload(f);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.queue]);

  // ── Polling interval ──────────────────────────────────────────────────────
  // Single long-lived interval that reads queueRef (always fresh) to avoid
  // stale-closure issues with setInterval + useState.

  useEffect(() => {
    const id = setInterval(async () => {
      const processing = queueRef.current.filter(
        (f) => f.stage === "processing" && f.pk && f.sk
      );
      if (processing.length === 0) return;

      await Promise.allSettled(
        processing.map(async (item) => {
          try {
            const res = await fetch("/api/media/status", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ pk: item.pk, sk: item.sk }),
            });
            const data = await res.json() as { exists: boolean; processingStatus: "processing" | "ready" | "failed" | null };
            // Check processingStatus (not just exists) — with early commit the
            // DynamoDB record exists immediately, but processingStatus transitions
            // from "processing" to "ready" only when Lambda/MediaConvert completes,
            // or to "failed" if MediaConvert emits an ERROR event.
            if (data.processingStatus === "ready") {
              dispatch({ type: "SUCCEED", fileId: item.fileId });
              window.dispatchEvent(
                new CustomEvent("upload:complete", {
                  detail: {
                    eventId: item.committedEventId,
                    mediaId: item.mediaId,
                    mediaType: item.mediaType,
                  },
                })
              );
            } else if (data.processingStatus === "failed") {
              // MediaConvert errored — move the queue item to failed so the
              // isMediaIdInQueue check clears and the Retry button appears on the card.
              dispatch({
                type: "FAIL",
                fileId: item.fileId,
                errorStage: "processing",
                errorMessage: "Video processing failed. Click Retry on the card.",
              });
            }
          } catch {
            // Ignore individual poll errors; next tick will retry.
          }
        })
      );
    }, POLL_INTERVAL_MS);

    return () => clearInterval(id);
  }, []); // Intentionally empty — reads queueRef which is always up-to-date.

  // ── Public API ────────────────────────────────────────────────────────────

  function enqueueFiles(files: File[], eventId: string, userId: string) {
    const items: UploadFileStatus[] = files.map((file) => {
      const heic = isHeicOrHeif(file);
      const video = isVideoFile(file) || isVideoByExtension(file);
      return {
        fileId: crypto.randomUUID(),
        file,
        filename: file.name,
        mediaType: video ? "video" : "photo",
        isHeic: heic,
        isVideo: video,
        stage: "idle",
        eventId,
        userId,
        retryCount: 0,
      };
    });
    dispatch({ type: "ENQUEUE", items });
  }

  function retryFile(fileId: string) {
    dispatch({ type: "RETRY", fileId });
  }

  function dismissCompleted() {
    dispatch({ type: "DISMISS_DONE" });
  }

  function togglePanel() {
    dispatch({ type: "TOGGLE_PANEL" });
  }

  function isMediaIdInQueue(mediaId: string): boolean {
    return state.queue.some(
      (f) => f.mediaId === mediaId && f.stage !== "done" && f.stage !== "failed" && f.stage !== "skipped"
    );
  }

  async function retryMedia(photo: {
    pk: string;
    sk: string;
    mediaId: string;
    filename: string;
    mediaType: "photo" | "video";
    eventId: string;
    takenAt?: string;
  }): Promise<void> {
    const res = await fetch("/api/media/retry-processing", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pk: photo.pk, sk: photo.sk }),
    });

    if (res.status === 410) {
      alert("The original file is no longer available. Please delete this item and re-upload.");
      return;
    }
    if (!res.ok) {
      alert("Retry failed. Please try again.");
      return;
    }

    // Add a pre-seeded "processing" item to the queue so the tray shows progress.
    // The existing poll interval will detect processingStatus: "ready" and call SUCCEED.
    const item: UploadFileStatus = {
      fileId: crypto.randomUUID(),
      filename: photo.filename,
      mediaType: photo.mediaType,
      isHeic: false,
      isVideo: photo.mediaType === "video",
      stage: "processing",
      eventId: photo.eventId,
      userId: "",
      retryCount: 1,
      mediaId: photo.mediaId,
      sk: photo.sk,
      pk: photo.pk,
      takenAt: photo.takenAt,
      committedEventId: photo.eventId,
    };

    dispatch({ type: "ENQUEUE", items: [item] });
    dispatch({ type: "SHOW" });
  }

  return (
    <UploadQueueContext.Provider
      value={{
        queue: state.queue,
        isVisible: state.isVisible,
        isPanelOpen: state.isPanelOpen,
        enqueueFiles,
        retryFile,
        dismissCompleted,
        togglePanel,
        isMediaIdInQueue,
        retryMedia,
      }}
    >
      {children}
    </UploadQueueContext.Provider>
  );
}
