"use client";

/**
 * Modal for uploading photos and videos to the family archive.
 *
 * ## Upload flow
 * 1. **File selection** — the user picks one or more image/video files.
 * 2. **HEIC/HEIF** — raw file is uploaded directly to S3 under `incoming/`
 *    and processed by the **ProcessHeic Lambda** (Sharp, native C++ codec).
 *    No client-side conversion. The modal polls `GET /api/media/status` until
 *    the Lambda commits the DynamoDB record.
 * 3. **Non-HEIC preparation** — JPEG/PNG images pass through unchanged;
 *    non-HEIC conversions (none currently) use `normalizeImage`.
 * 4. **Preview generation** — for non-HEIC photos a thumbnail JPEG is
 *    generated via Canvas (max 1200 px); for videos a poster frame is captured.
 * 5. **Presigned-URL request** — calls `POST /api/upload-url` for the preview
 *    (kind=`"preview"`), the display file (kind=`"original"`), and for HEIC
 *    the incoming slot (kind=`"incoming"`).
 * 6. **S3 PUT** — bytes are PUT directly to S3 via presigned URLs.
 * 7. **DynamoDB commit** — non-HEIC files call `POST /api/media/commit` after
 *    S3. HEIC files are committed by the Lambda after conversion.
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
  /**
   * The raw original file before HEIC→JPEG conversion.
   * Only present for the legacy client-side HEIC path; `undefined` otherwise.
   */
  originalFile?: File;
  /**
   * When true, this file is uploaded raw to `incoming/` and converted by the
   * ProcessHeic Lambda rather than being converted client-side.
   */
  viaLambda: boolean;
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
 * clamped to 1200 px while preserving aspect ratio.
 *
 * @param file - An image `File` (any browser-decodable format).
 * @returns A JPEG `Blob` at most 1200 × 1200 px.
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
 * clamped to 1200 px. Waits for both `loadedmetadata` and `loadeddata` before
 * seeking to maximise cross-browser compatibility (especially Safari).
 *
 * @param file - A video `File` in any browser-decodable format.
 * @returns A JPEG `Blob` at most 1200 × 1200 px.
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
    "idle" | "preparing" | "uploading" | "processing" | "finishing"
  >("idle");

  const [processingTotal, setProcessingTotal] = useState(0);
  const [processingDone, setProcessingDone] = useState(0);

  const [showDetails, setShowDetails] = useState(false);
  const [activePreparingFiles, setActivePreparingFiles] = useState<
    { name: string; startedAt: number }[]
  >([]);
  const [activeUploadingNames, setActiveUploadingNames] = useState<string[]>([]);
  const [, setTick] = useState(0);
  const [skippedFiles, setSkippedFiles] = useState<string[]>([]);

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
    setShowDetails(false);
    setActivePreparingFiles([]);
    setActiveUploadingNames([]);
    setSkippedFiles([]);
    setProcessingTotal(0);
    setProcessingDone(0);
  }, [open]);

  useEffect(() => {
    if (phase !== "preparing") return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  if (!open) return null;

  /**
   * Converts a HEIC/HEIF file to JPEG.
   *
   * Strategy (fastest first):
   * 1. Native browser decoding via createImageBitmap + canvas — available on
   *    Chrome 111+ and all Safari versions. Uses the browser's native C++ codec,
   *    so it's orders of magnitude faster than a JS decoder.
   * 2. heic2any fallback — pure-JS decoder for Firefox and older Chrome. Slow
   *    for large files but correct.
   *
   * Returns the original file unchanged if it is not HEIC/HEIF.
   */
  async function normalizeImage(file: File): Promise<File> {
    if (!isHeicOrHeif(file)) return file;

    // Attempt native decode first.
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
      bitmap.close();
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
          "image/jpeg",
          0.95
        )
      );
      return new File([blob], replaceExtToJpg(file.name), {
        type: "image/jpeg",
        lastModified: Date.now(),
      });
    } catch {
      // Browser doesn't support native HEIC decoding — fall through to heic2any.
    }

    // heic2any fallback (Firefox, older Chrome).
    // Race against a 60-second timeout — heic2any has no built-in limit and
    // can silently hang on large or malformed HEIC files.
    try {
      const mod = await import("heic2any");
      const heic2any = (mod as any).default || mod;

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("heic2any conversion timed out")),
          60_000
        )
      );

      const convertedBlob = await Promise.race([
        heic2any({ blob: file, toType: "image/jpeg", quality: 0.95 }),
        timeoutPromise,
      ]);

      return new File([convertedBlob as Blob], replaceExtToJpg(file.name), {
        type: "image/jpeg",
        lastModified: Date.now(),
      });
    } catch (err: any) {
      const msg = String(err?.message || err || "");
      if (msg.includes("already browser readable")) {
        // heic2any detected the file's actual bytes are already a browser-readable
        // format (most commonly JPEG — macOS/iCloud delivers HEIC-named files that
        // contain JPEG data). Wrap in a new File so:
        //   1. S3 gets the correct Content-Type ("image/jpeg") instead of "image/heic"
        //   2. processed !== original, which lets handleUpload set originalFile
        //      so the raw source file is still preserved under originals/ in S3.
        const detectedType = msg.match(/image\/\w+/)?.[0] ?? "image/jpeg";
        const ext = detectedType === "image/jpeg" ? ".jpg" : ".png";
        const safeName = file.name.replace(/\.(heic|heif)$/i, ext);
        return new File([file], safeName, { type: detectedType, lastModified: file.lastModified });
      }
      throw err;
    }
  }

  /**
   * Pre-processes a file before upload. Currently only normalises HEIC/HEIF
   * images; all other files (video, JPEG, PNG, etc.) pass through unchanged.
   */
  async function preprocessFile(file: File): Promise<File> {
    // HEIC/HEIF files are uploaded raw and converted by the ProcessHeic Lambda —
    // no client-side conversion needed.
    if (isHeicOrHeif(file)) return file;
    if (isImageFile(file)) return normalizeImage(file);
    return file;
  }

  /**
   * Requests a presigned S3 PUT URL from `/api/upload-url`.
   *
   * For `kind === "original"`, the response also includes the `mediaId`, `sk`,
   * `takenAt`, `filename`, and `eventId` fields needed for the commit step.
   * These are guaranteed present for originals and absent for previews/archives.
   *
   * Pass `mediaId` when requesting an archive URL so both S3 keys share the
   * same UUID as the display JPEG.
   *
   * @throws If the server returns a non-2xx status.
   */
  async function requestSignedUrl(args: {
    filename: string;
    filetype: string;
    userId: string;
    eventId: string;
    mediaType: "photo" | "video";
    kind: "preview" | "original" | "archive" | "incoming";
    thumbnailKey?: string;
    /** Pass the mediaId from the original response when kind === "archive". */
    mediaId?: string;
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
      kind: "preview" | "original" | "archive";
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
   * calling `POST /api/media/commit`. This is called only after all S3 PUTs
   * succeed, implementing the two-phase upload commit pattern.
   *
   * `archiveKey` is optional — only present for HEIC/HEIF originals.
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
    /** S3 key for the lossless HEIC original. Absent for non-HEIC uploads. */
    archiveKey?: string;
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
   * 2. Request presigned URLs for preview, original, and (for HEIC) archive.
   * 3. PUT preview bytes to S3.
   * 4. PUT original bytes to S3.
   * 5. PUT HEIC bytes to S3 (HEIC uploads only).
   * 6. Commit the DynamoDB record (with archiveKey if applicable).
   *
   * Video poster generation failures are non-fatal — the upload continues
   * without a thumbnail rather than aborting.
   *
   * @param file          - The display file (or raw HEIC when viaLambda).
   * @param eventIdValue  - The event ID to associate this upload with.
   * @param userId        - The authenticated user's Cognito sub.
   * @param originalFile  - The raw HEIC/HEIF file (legacy client-side path only).
   * @param viaLambda     - When true, upload raw HEIC to incoming/ and invoke Lambda.
   * @returns `{ pk, sk }` for Lambda jobs (used to poll for completion), else void.
   */
  async function uploadOneFile(
    file: File,
    eventIdValue: string,
    userId: string,
    originalFile: File | undefined,
    viaLambda: boolean
  ): Promise<{ pk: string; sk: string } | undefined> {
    // Lambda path: upload raw file to incoming/, fire Lambda, return poll tokens.
    if (viaLambda) {
      const isVideo = isVideoFile(file) || isVideoByExtension(file);
      const fileType = isVideo
        ? (file.type || "video/quicktime")
        : (file.type || "image/heic");
      const processEndpoint = isVideo ? "/api/media/process-video" : "/api/media/process";

      const incomingResp = await requestSignedUrl({
        filename: file.name,
        filetype: fileType,
        userId,
        eventId: eventIdValue,
        mediaType: isVideo ? "video" : "photo",
        kind: "incoming",
      });

      const { mediaId, sk, takenAt, filename: safeName, eventId: committedEventId } = incomingResp;
      if (!mediaId || !sk || !takenAt || !safeName || !committedEventId) {
        throw new Error("upload-url response missing commit fields for incoming file");
      }

      await putToS3(incomingResp.signedUrl, fileType, file);

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
      if (!processRes.ok) throw new Error(`process failed: ${processRes.status}`);

      return { pk: `EVENT#${committedEventId}`, sk };
    }

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

    const { mediaId, sk, takenAt, filename: safeName, eventId: committedEventId } = originalResp;
    if (!mediaId || !sk || !takenAt || !safeName || !committedEventId) {
      throw new Error("upload-url response missing commit fields");
    }

    // For HEIC originals, request a separate archive URL that shares the same
    // mediaId so both S3 objects are linked by the same UUID prefix.
    let archiveKey: string | undefined;
    if (mediaType === "photo" && originalFile && isHeicOrHeif(originalFile)) {
      const heicType = originalFile.type || "image/heic";
      const archiveResp = await requestSignedUrl({
        filename: originalFile.name,
        filetype: heicType,
        userId,
        eventId: eventIdValue,
        mediaType,
        kind: "archive",
        mediaId,
      });

      archiveKey = archiveResp.s3Key;
      await putToS3(archiveResp.signedUrl, heicType, originalFile);
    }

    // Upload the display file (JPEG) directly to S3 via the presigned URL.
    await putToS3(originalResp.signedUrl, mimeType, file);

    // Only after all S3 uploads succeed do we write the DynamoDB record.
    // This prevents orphaned metadata records for interrupted uploads.
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
      archiveKey,
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
  async function runWithConcurrency<T>(
    jobs: T[],
    concurrency: number,
    worker: (job: T) => Promise<void>
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
      const prepJobs: { file: File; index: number }[] = files.map((file, index) => ({ file, index }));
      const jobs: Job[] = new Array(files.length);

      await runWithConcurrency(prepJobs, 4, async ({ file, index }) => {
        setActivePreparingFiles((prev) => [
          ...prev,
          { name: file.name, startedAt: Date.now() },
        ]);
        try {
          const processed = await preprocessFile(file);

          // Retain the raw file reference for HEIC originals so uploadOneFile can
          // PUT the lossless HEIC to S3 alongside the converted JPEG.
          const originalFile =
            isHeicOrHeif(file) && processed !== file ? file : undefined;

          jobs[index] = {
            index,
            file: processed,
            originalFile,
            viaLambda: isHeicOrHeif(file) || isVideoFile(file) || isVideoByExtension(file),
          };
          setPreparedCount((c) => c + 1);
        } catch (err: any) {
          if (err?.message?.includes("conversion timed out")) {
            // Skip this file rather than aborting the entire batch.
            // jobs[index] stays undefined and is filtered out before uploading.
            setSkippedFiles((prev) => [...prev, file.name]);
            setPreparedCount((c) => c + 1);
          } else {
            throw err;
          }
        } finally {
          setActivePreparingFiles((prev) =>
            prev.filter((f) => f.name !== file.name)
          );
        }
      });

      // Remove slots that were skipped due to conversion timeout.
      const uploadJobs = jobs.filter(Boolean);

      setPhase("uploading");

      const pendingLambdaJobs: { pk: string; sk: string }[] = [];

      await runWithConcurrency(uploadJobs, 3, async (job) => {
        setActiveCount((c) => c + 1);
        setActiveUploadingNames((prev) => [...prev, job.file.name]);

        try {
          const lambdaResult = await uploadOneFile(
            job.file,
            eventId,
            user.sub,
            job.originalFile,
            job.viaLambda
          );
          if (lambdaResult) pendingLambdaJobs.push(lambdaResult);
          setCompletedCount((c) => c + 1);
        } finally {
          setActiveCount((c) => Math.max(0, c - 1));
          setActiveUploadingNames((prev) =>
            prev.filter((n) => n !== job.file.name)
          );
        }
      });

      // Poll until all Lambda-processed HEIC files are committed to DynamoDB.
      if (pendingLambdaJobs.length > 0) {
        setPhase("processing");
        setProcessingTotal(pendingLambdaJobs.length);
        let pending = [...pendingLambdaJobs];

        while (pending.length > 0) {
          await new Promise((r) => setTimeout(r, 2500));
          const checks = await Promise.all(
            pending.map(({ pk, sk }) =>
              fetch("/api/media/status", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pk, sk }),
              })
                .then((r) => r.json())
                .then((d) => ({ pk, sk, done: Boolean(d.exists) }))
            )
          );
          for (const item of checks) {
            if (item.done) {
              pending = pending.filter(
                (p) => !(p.pk === item.pk && p.sk === item.sk)
              );
              setProcessingDone((c) => c + 1);
            }
          }
        }
      }

      setPhase("finishing");

      setFiles([]);
      setSelectedEvent("");
      setNewEvent("");

      onUploadSuccess();

      // Warn about any HEIC files that timed out and were skipped.
      // Read skippedFiles via a ref snapshot so we don't need it in deps.
      const skipped = jobs
        .map((_, i) => (jobs[i] ? null : prepJobs[i]?.file.name))
        .filter(Boolean) as string[];
      if (skipped.length > 0) {
        alert(
          `${skipped.length} HEIC file${skipped.length === 1 ? "" : "s"} couldn't be converted in time and were skipped:\n\n${skipped.slice(0, 5).join("\n")}${skipped.length > 5 ? `\n…and ${skipped.length - 5} more` : ""}`
        );
      }

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
      setActivePreparingFiles([]);
      setActiveUploadingNames([]);
      setSkippedFiles([]);
      setProcessingTotal(0);
      setProcessingDone(0);
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
              className="rounded-xl border border-neutral-800 bg-neutral-900/40 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-900 transition"
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
              {phase === "processing" ? (
                <>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-neutral-100">
                        Converting files
                      </div>
                      <div className="mt-1 text-xs text-neutral-400">
                        Lambda converting on server · much faster than browser
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-2xl font-semibold tabular-nums">
                        {processingTotal > 0
                          ? `${Math.round((processingDone / processingTotal) * 100)}%`
                          : "0%"}
                      </div>
                      <div className="text-[11px] text-neutral-400 tabular-nums">
                        Processing
                      </div>
                    </div>
                  </div>
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-[11px] text-neutral-400">
                      <span>Converting</span>
                      <span className="tabular-nums">
                        {processingDone}/{processingTotal}
                      </span>
                    </div>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-800">
                      <div
                        className="h-full rounded-full bg-emerald-400 transition-[width] duration-300 ease-out"
                        style={{
                          width: `${processingTotal > 0 ? (processingDone / processingTotal) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <>
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

                  <button
                    type="button"
                    onClick={() => setShowDetails((v) => !v)}
                    className="mt-3 text-[11px] text-neutral-500 hover:text-neutral-300 transition"
                  >
                    {showDetails ? "Hide details" : "Show details"}
                  </button>

                  {showDetails && (() => {
                    if (phase === "preparing") {
                      return activePreparingFiles.length > 0 ? (
                        <div className="mt-2 max-h-24 overflow-y-auto space-y-0.5">
                          {activePreparingFiles.map(({ name, startedAt }) => {
                            const secs = Math.floor((Date.now() - startedAt) / 1000);
                            const elapsed =
                              secs >= 60
                                ? `${Math.floor(secs / 60)}m ${secs % 60}s`
                                : `${secs}s`;
                            return (
                              <div
                                key={name}
                                className="truncate font-mono text-[11px] text-neutral-400"
                              >
                                Converting {name}{" "}
                                <span className="text-neutral-500">· {elapsed}</span>
                              </div>
                            );
                          })}
                        </div>
                      ) : null;
                    }
                    return activeUploadingNames.length > 0 ? (
                      <div className="mt-2 max-h-24 overflow-y-auto space-y-0.5">
                        {activeUploadingNames.map((name) => (
                          <div
                            key={name}
                            className="truncate font-mono text-[11px] text-neutral-400"
                          >
                            Uploading {name}
                          </div>
                        ))}
                      </div>
                    ) : null;
                  })()}
                </>
              )}
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
