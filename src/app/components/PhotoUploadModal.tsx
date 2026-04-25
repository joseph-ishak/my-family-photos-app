"use client";

/**
 * Modal for uploading photos and videos to the family archive.
 *
 * ## Upload flow
 * 1. **File selection** — the user picks one or more image/video files.
 * 2. **HEIC conversion** — HEIC/HEIF images are converted to JPEG client-side
 *    via `heic2any` before anything is sent to S3.
 * 3. **Preview generation** — for photos a thumbnail JPEG is generated via
 *    Canvas (max 480 px); for videos a poster frame is captured from early in
 *    the clip (5 % of duration, capped at 0.2 s).
 * 4. **Presigned-URL request** — calls `POST /api/upload-url` twice per file:
 *    once for the preview (kind=`"preview"`) and once for the original
 *    (kind=`"original"`). Both return presigned S3 PUT URLs.
 * 5. **S3 PUT** — preview and original bytes are PUT directly to S3.
 * 6. **DynamoDB commit** — only after the S3 PUT succeeds does the component
 *    call `POST /api/media/commit` to write the metadata record, preventing
 *    orphaned DB entries for incomplete uploads.
 *
 * Files are uploaded with concurrency-3 parallelism. Two progress bars track
 * "preparing" (HEIC conversion + preview generation) and "uploading" (S3 PUTs)
 * phases independently.
 *
 * `lockedEventId` pins uploads to a specific event and hides the event picker
 * (used from event detail pages).
 */

import React, { useEffect, useMemo, useState } from "react";

/** Props accepted by `PhotoUploadModal`. */
type Props = {
  /** Whether the modal is visible. */
  open: boolean;
  /** Called when the modal should close (both cancel and after success). */
  onClose: () => void;
  /** Called after all files have been committed to DynamoDB successfully. */
  onUploadSuccess: () => void;
  /** Event IDs shown in the event dropdown. */
  existingEvents: string[];
  /** Authenticated user object — must provide `sub` (Cognito user ID). */
  user: any;
  /**
   * When set, uploads are locked to this event ID and the event picker is
   * hidden. Useful when uploading from an event detail page.
   */
  lockedEventId?: string;
};

/** A single upload job that tracks the file and its position in the queue. */
type Job = {
  /** Index in the original file list — used for progress tracking. */
  index: number;
  /** The (possibly pre-processed) file to upload. */
  file: File;
};

/** Returns `true` if the file's MIME type indicates a video. */
function isVideoFile(file: File) {
  return file.type.startsWith("video/");
}

/** Returns `true` if the file's MIME type indicates an image. */
function isImageFile(file: File) {
  return file.type.startsWith("image/");
}

/**
 * Generates a JPEG thumbnail for a photo file by drawing it onto an off-screen
 * canvas and encoding the result at 78 % quality. The longest dimension is
 * clamped to 480 px while preserving aspect ratio.
 *
 * @param file - An image `File` (any browser-decodable format).
 * @returns A JPEG `Blob` at most 480 × 480 px.
 */
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

    const maxSide = 480;
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

    const blob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Preview encode failed"))),
        "image/jpeg",
        0.78
      );
    });

    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Captures a poster frame from a video file and encodes it as a JPEG thumbnail.
 *
 * Seeks to 5 % of the video's duration (capped at 0.2 s) and draws that frame
 * onto an off-screen canvas at 80 % JPEG quality. The longest dimension is
 * clamped to 480 px. Waits for both `loadedmetadata` and `loadeddata` before
 * seeking to maximise cross-browser compatibility (especially Safari).
 *
 * @param file - A video `File` in any browser-decodable format.
 * @returns A JPEG `Blob` at most 480 × 480 px.
 * @throws If the video cannot be decoded or the poster frame cannot be captured.
 */
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

      const onMeta = () => {
        gotMeta = true;
        tryResolve();
      };

      const onData = () => {
        gotData = true;
        tryResolve();
      };

      const onError = () => {
        cleanup();
        reject(new Error("Video load failed"));
      };

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
      const onSeeked = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("Video seek failed"));
      };
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
        reject(new Error("Video currentTime set failed"));
      }
    });

    const vw = video.videoWidth || 0;
    const vh = video.videoHeight || 0;
    if (!vw || !vh) throw new Error("Video dimensions missing");

    const maxSide = 480;
    const scale = Math.min(1, maxSide / Math.max(vw, vh));
    const outW = Math.max(1, Math.round(vw * scale));
    const outH = Math.max(1, Math.round(vh * scale));

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas context missing");

    ctx.drawImage(video, 0, 0, outW, outH);

    const blob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Poster encode failed"))),
        "image/jpeg",
        0.8
      );
    });

    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Clamps a number to the range `[0, 100]` for use as a CSS percentage. */
function clampPct(n: number) {
  return Math.max(0, Math.min(100, n));
}

/**
 * Calculates the integer percentage of `done` out of `total`.
 * Returns `0` when `total` is falsy to avoid division-by-zero.
 */
function pct(done: number, total: number) {
  if (!total) return 0;
  return clampPct(Math.round((done / total) * 100));
}

/**
 * Returns `true` if the file appears to be a HEIC/HEIF image based on its
 * MIME type or file extension. Browsers often report an empty MIME type for
 * these files, so checking both is necessary.
 */
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

/**
 * Video file extensions used as a fallback when the MIME type is absent.
 * iPhone `.mov` files in particular often arrive with an empty type from the
 * browser's file picker.
 */
const VIDEO_EXTENSIONS = [".mov", ".mp4", ".m4v", ".avi", ".mkv", ".webm"];

/**
 * Returns `true` if the file's extension matches a known video format.
 * Used as a fallback when `file.type` is empty (common for iOS `.mov` files).
 */
function isVideoByExtension(file: File) {
  const name = (file.name || "").toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/**
 * Replaces a `.heic` or `.heif` extension with `.jpg` in a filename.
 * Used to produce a safe filename for the converted JPEG before upload.
 */
function replaceExtToJpg(name: string) {
  if (!name) return "image.jpg";
  if (/\.(heic|heif)$/i.test(name))
    return name.replace(/\.(heic|heif)$/i, ".jpg");
  return name;
}

/**
 * Upload modal component.
 *
 * Manages its own upload-phase state machine (`idle` → `preparing` →
 * `uploading` → `finishing` → `idle`) and renders dual progress bars during
 * the active upload. Resets all counters each time the modal opens.
 */
export default function PhotoUploadModal({
  open,
  onClose,
  onUploadSuccess,
  existingEvents,
  user,
  lockedEventId,
}: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<string>("");
  const [newEvent, setNewEvent] = useState<string>("");

  const [uploading, setUploading] = useState(false);

  const [preparedCount, setPreparedCount] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [activeCount, setActiveCount] = useState(0);

  const [phase, setPhase] = useState<
    "idle" | "preparing" | "uploading" | "finishing"
  >("idle");

  const locked = (lockedEventId || "").trim();
  const effectiveSelectedEvent = locked || selectedEvent;

  const isCreatingNew = effectiveSelectedEvent === "__new__";
  const eventId = (isCreatingNew ? newEvent : effectiveSelectedEvent).trim();

  const totalFiles = files.length;

  const preparingProgress = useMemo(
    () => pct(preparedCount, totalFiles),
    [preparedCount, totalFiles]
  );

  const uploadingProgress = useMemo(
    () => pct(completedCount, totalFiles),
    [completedCount, totalFiles]
  );

  useEffect(() => {
    if (!open) return;
    setPreparedCount(0);
    setCompletedCount(0);
    setActiveCount(0);
    setPhase("idle");
  }, [open]);

  if (!open) return null;

  /**
   * Converts a HEIC/HEIF file to JPEG using `heic2any` (lazily imported).
   * Returns the original file unchanged if it is not HEIC/HEIF or if
   * `heic2any` reports the file is already browser-readable.
   */
  async function normalizeImage(file: File): Promise<File> {
    if (!isHeicOrHeif(file)) return file;

    try {
      const mod = await import("heic2any");
      const heic2any = (mod as any).default || mod;

      const convertedBlob = await heic2any({
        blob: file,
        toType: "image/jpeg",
        quality: 0.9,
      });

      return new File([convertedBlob as Blob], replaceExtToJpg(file.name), {
        type: "image/jpeg",
        lastModified: Date.now(),
      });
    } catch (err: any) {
      const msg = String(err?.message || err || "");
      if (msg.includes("already browser readable")) return file;
      throw err;
    }
  }

  /**
   * Pre-processes a file before upload. Currently only normalises HEIC/HEIF
   * images; all other files (video, JPEG, PNG, etc.) pass through unchanged.
   */
  async function preprocessFile(file: File): Promise<File> {
    if (isImageFile(file)) return normalizeImage(file);
    return file;
  }

  /**
   * Requests a presigned S3 PUT URL from `/api/upload-url`.
   *
   * For `kind === "original"`, the response also includes the `mediaId`, `sk`,
   * `takenAt`, `filename`, and `eventId` fields needed for the commit step.
   * These are guaranteed present for originals and absent for previews.
   *
   * @throws If the server returns a non-2xx status.
   */
  async function requestSignedUrl(args: {
    filename: string;
    filetype: string;
    userId: string;
    eventId: string;
    mediaType: "photo" | "video";
    kind: "preview" | "original";
    thumbnailKey?: string;
  }) {
    const res = await fetch("/api/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });

    if (!res.ok) throw new Error(`upload url failed: ${res.status}`);

    return (await res.json()) as {
      signedUrl: string;
      s3Key: string;
      mediaType: "photo" | "video";
      kind: "preview" | "original";
      // Returned for kind === "original" only — used in the commit step.
      mediaId?: string;
      sk?: string;
      takenAt?: string;
      filename?: string;
      eventId?: string;
    };
  }

  /**
   * Writes the DynamoDB metadata record for a successfully uploaded file by
   * calling `POST /api/media/commit`. This is called only after the S3 PUT
   * succeeds, implementing the two-phase upload commit pattern.
   *
   * @throws If the server returns a non-2xx status.
   */
  async function commitUpload(args: {
    mediaId: string;
    sk: string;
    s3Key: string;
    eventId: string;
    takenAt: string;
    mimeType: string;
    filename: string;
    mediaType: "photo" | "video";
    thumbnailKey?: string;
  }) {
    const res = await fetch("/api/media/commit", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });

    if (!res.ok) throw new Error(`commit failed: ${res.status}`);
  }

  /**
   * PUTs `body` directly to S3 via a presigned URL.
   *
   * @param signedUrl   - The presigned S3 PUT URL.
   * @param contentType - MIME type to set as the `Content-Type` header.
   * @param body        - Blob to upload.
   * @throws If the S3 PUT returns a non-2xx status.
   */
  async function putToS3(signedUrl: string, contentType: string, body: Blob) {
    const uploadRes = await fetch(signedUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body,
    });

    if (!uploadRes.ok) throw new Error(`upload failed: ${uploadRes.status}`);
  }

  /**
   * Handles the complete upload lifecycle for a single file:
   * 1. Generate preview/poster thumbnail.
   * 2. Request presigned URLs for preview and original.
   * 3. PUT preview bytes to S3.
   * 4. PUT original bytes to S3.
   * 5. Commit the DynamoDB record.
   *
   * Video poster generation failures are non-fatal — the upload continues
   * without a thumbnail rather than aborting.
   */
  async function uploadOneFile(
    file: File,
    eventIdValue: string,
    userId: string
  ) {
    const mediaType: "photo" | "video" =
      isVideoFile(file) || isVideoByExtension(file) ? "video" : "photo";

    let thumbnailKey: string | undefined;

    if (mediaType === "photo") {
      const previewBlob = await imageFileToPreviewBlob(file);

      const previewResp = await requestSignedUrl({
        filename: "preview.jpg",
        filetype: "image/jpeg",
        userId,
        eventId: eventIdValue,
        mediaType,
        kind: "preview",
      });

      thumbnailKey = previewResp.s3Key;
      await putToS3(previewResp.signedUrl, "image/jpeg", previewBlob);
    }

    if (mediaType === "video") {
      try {
        const posterBlob = await videoFileToPosterBlob(file);

        const previewResp = await requestSignedUrl({
          filename: "poster.jpg",
          filetype: "image/jpeg",
          userId,
          eventId: eventIdValue,
          mediaType,
          kind: "preview",
        });

        thumbnailKey = previewResp.s3Key;
        await putToS3(previewResp.signedUrl, "image/jpeg", posterBlob);
      } catch (e) {
        console.warn(
          "Video poster generation failed, continuing without it",
          e
        );
      }
    }

    const mimeType = file.type || "application/octet-stream";

    const originalResp = await requestSignedUrl({
      filename: file.name,
      filetype: mimeType,
      userId,
      eventId: eventIdValue,
      mediaType,
      kind: "original",
      thumbnailKey,
    });

    // Upload the file bytes directly to S3 via the presigned URL.
    await putToS3(originalResp.signedUrl, mimeType, file);

    // Only after S3 confirms the upload do we write the DynamoDB record.
    // This prevents orphaned metadata records for interrupted uploads.
    const { mediaId, sk, takenAt, filename: safeName, eventId: committedEventId } = originalResp;
    if (!mediaId || !sk || !takenAt || !safeName || !committedEventId) {
      throw new Error("upload-url response missing commit fields");
    }

    await commitUpload({
      mediaId,
      sk,
      s3Key: originalResp.s3Key,
      eventId: committedEventId,
      takenAt,
      mimeType,
      filename: safeName,
      mediaType,
      thumbnailKey,
    });
  }

  /**
   * Processes an array of jobs with bounded concurrency using a pull-from-queue
   * pattern. Spawns `concurrency` long-running "runner" coroutines that each
   * pull the next unstarted job and call `worker`. Stops all runners and
   * re-throws the first error encountered.
   *
   * @param jobs        - Ordered list of upload jobs.
   * @param concurrency - Maximum number of simultaneous uploads.
   * @param worker      - Async function to execute for each job.
   */
  async function runWithConcurrency(
    jobs: Job[],
    concurrency: number,
    worker: (job: Job) => Promise<void>
  ) {
    let next = 0;
    let firstError: unknown = null;

    async function runner() {
      while (true) {
        if (firstError) return;

        const job = jobs[next];
        if (!job) return;

        next += 1;

        try {
          await worker(job);
        } catch (err) {
          firstError = err;
          return;
        }
      }
    }

    const runners = Array.from({ length: Math.max(1, concurrency) }, () =>
      runner()
    );
    await Promise.all(runners);

    if (firstError) throw firstError;
  }

  const uploadDisabled =
    uploading ||
    !totalFiles ||
    !user ||
    !eventId ||
    (!locked && isCreatingNew && !newEvent.trim());

  /**
   * Handles file picker selection. Filters out unsupported file types and
   * alerts the user if any files were skipped. Resets all progress counters.
   */
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    const supported = picked.filter(
      (f) => isImageFile(f) || isVideoFile(f) || isHeicOrHeif(f) || isVideoByExtension(f)
    );

    setFiles(supported);
    setPreparedCount(0);
    setCompletedCount(0);
    setActiveCount(0);
    setPhase("idle");

    if (picked.length !== supported.length) {
      alert("Some files were skipped because they are not supported.");
    }
  };

  /**
   * Orchestrates the full upload sequence: HEIC normalization, concurrent S3
   * uploads, and commit calls. Drives the `phase` state machine and progress
   * counters. Calls `onUploadSuccess` and `onClose` after all files are done.
   */
  const handleUpload = async () => {
    if (!files.length || !user || !eventId) return;

    setUploading(true);
    setPreparedCount(0);
    setCompletedCount(0);
    setActiveCount(0);
    setPhase("preparing");

    try {
      const processedFiles: File[] = [];

      for (let i = 0; i < files.length; i += 1) {
        const pf = await preprocessFile(files[i]);
        processedFiles.push(pf);
        setPreparedCount(i + 1);
      }

      const jobs: Job[] = processedFiles.map((file, index) => ({
        file,
        index,
      }));

      setPhase("uploading");

      await runWithConcurrency(jobs, 3, async (job) => {
        setActiveCount((c) => c + 1);

        try {
          await uploadOneFile(job.file, eventId, user.sub);
          setCompletedCount((c) => c + 1);
        } finally {
          setActiveCount((c) => Math.max(0, c - 1));
        }
      });

      setPhase("finishing");

      setFiles([]);
      setSelectedEvent("");
      setNewEvent("");

      onUploadSuccess();
      onClose();
    } catch (err) {
      console.error(err);
      alert("Upload failed");
    } finally {
      setUploading(false);
      setPhase("idle");
      setPreparedCount(0);
      setCompletedCount(0);
      setActiveCount(0);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3">
      <div className="w-[94vw] max-w-2xl overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-950 text-neutral-100 shadow-2xl">
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xl font-semibold tracking-tight">Upload</div>
              <div className="mt-1 text-sm text-neutral-400">
                Add photos and videos to your library.
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              disabled={uploading}
              className="rounded-xl border border-neutral-800 bg-neutral-900/40 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-900 transition disabled:opacity-60"
            >
              Close
            </button>
          </div>
        </div>

        <div className="px-6 pb-6 space-y-5">
          <div className="space-y-2">
            <div className="text-sm font-medium text-neutral-200">
              Choose files
            </div>
            <input
              type="file"
              multiple
              accept="image/*,video/*"
              onChange={handleFileChange}
              disabled={uploading}
              className="block w-full text-sm text-neutral-200 file:mr-4 file:rounded-xl file:border-0 file:bg-neutral-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-neutral-900 hover:file:opacity-90"
            />
            {!uploading && totalFiles > 0 ? (
              <div className="text-xs text-neutral-400">
                {totalFiles} file{totalFiles === 1 ? "" : "s"} selected
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium text-neutral-200">Event</div>
            <select
              className="w-full rounded-2xl border border-neutral-800 bg-neutral-900/40 px-4 py-3 text-sm text-neutral-100 outline-none focus:border-neutral-600"
              value={effectiveSelectedEvent}
              onChange={(e) => setSelectedEvent(e.target.value)}
              disabled={uploading || Boolean(locked)}
            >
              <option value="">Select event</option>
              {existingEvents.map((ev) => (
                <option key={ev} value={ev}>
                  {ev}
                </option>
              ))}
              <option value="__new__">Create new event</option>
            </select>

            {locked ? (
              <div className="text-xs text-neutral-400">
                Uploading into this event.
              </div>
            ) : null}

            {!locked && isCreatingNew ? (
              <input
                type="text"
                placeholder="New event name"
                value={newEvent}
                onChange={(e) => setNewEvent(e.target.value)}
                disabled={uploading}
                className="w-full rounded-2xl border border-neutral-800 bg-neutral-900/40 px-4 py-3 text-sm text-neutral-100 outline-none focus:border-neutral-600"
              />
            ) : null}
          </div>

          {uploading ? (
            <div className="rounded-3xl border border-neutral-800 bg-neutral-900/30 p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-neutral-100">
                    {phase === "preparing"
                      ? "Preparing files"
                      : phase === "uploading"
                      ? "Uploading files"
                      : phase === "finishing"
                      ? "Finishing"
                      : "Working"}
                  </div>
                  <div className="mt-1 text-xs text-neutral-400">
                    {totalFiles ? `${totalFiles} total` : ""}
                    {activeCount ? ` • ${activeCount} active` : ""}
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <div className="text-2xl font-semibold tabular-nums">
                    {phase === "preparing"
                      ? `${preparingProgress}%`
                      : `${uploadingProgress}%`}
                  </div>
                  <div className="text-[11px] text-neutral-400 tabular-nums">
                    {phase === "preparing" ? "Preparing" : "Uploading"}
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-4">
                <div>
                  <div className="flex items-center justify-between text-[11px] text-neutral-400">
                    <span>Preparing</span>
                    <span className="tabular-nums">
                      {preparedCount}/{totalFiles}
                    </span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-800">
                    <div
                      className="h-full rounded-full bg-neutral-200 transition-[width] duration-300 ease-out"
                      style={{ width: `${preparingProgress}%` }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between text-[11px] text-neutral-400">
                    <span>Uploading</span>
                    <span className="tabular-nums">
                      {completedCount}/{totalFiles}
                    </span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-800">
                    <div
                      className="h-full rounded-full bg-white transition-[width] duration-300 ease-out"
                      style={{ width: `${uploadingProgress}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={handleUpload}
              disabled={uploadDisabled}
              className="rounded-2xl bg-neutral-50 px-6 py-3 text-sm font-medium text-neutral-900 hover:opacity-90 transition disabled:opacity-50"
            >
              {uploading ? "Uploading…" : "Upload"}
            </button>

            <button
              onClick={onClose}
              disabled={uploading}
              className="rounded-2xl border border-neutral-800 bg-neutral-900/40 px-6 py-3 text-sm font-medium text-neutral-200 hover:bg-neutral-900 transition disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
