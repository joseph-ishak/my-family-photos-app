/**
 * Types for the global background upload queue.
 *
 * Each file in the queue progresses through a linear stage machine.
 * Intermediate results are cached on the item so that any stage can be
 * retried without restarting from scratch (e.g. a failed S3 PUT keeps the
 * already-generated thumbnail blob so it doesn't need to be re-rendered).
 *
 * Stage flow:
 *   idle → preparing → requesting_url → uploading_preview → uploading_original
 *        → committing → done          (direct photo path)
 *   idle → preparing → requesting_url → uploading_original
 *        → queued_processing → processing → done   (HEIC / video Lambda path)
 */

export type UploadStage =
  | "idle"
  | "preparing"
  | "requesting_url"
  | "uploading_preview"
  | "uploading_original"
  | "committing"
  | "queued_processing"
  | "processing"
  | "done"
  | "failed"
  | "skipped";

export type UploadFileStatus = {
  fileId: string;
  /** Original File reference — kept for workers and retry. Absent for gallery retries. */
  file?: File;
  filename: string;
  mediaType: "photo" | "video";
  isHeic: boolean;
  isVideo: boolean;
  stage: UploadStage;
  /** Which stage the file was in when it failed — shown in the retry UI. */
  errorStage?: UploadStage;
  errorMessage?: string;
  eventId: string;
  userId: string;
  retryCount: number;

  // --- Cached intermediate results for retry-from-stage ---
  /** Client-generated preview/poster blob — expensive to regenerate. */
  preparedBlob?: Blob;
  /** S3 key for the already-uploaded preview — skip re-upload on retry. */
  previewS3Key?: string;
  /** S3 key assigned by the server for the original / incoming file. */
  originalS3Key?: string;
  /** S3 key for the raw file under incoming/ (HEIC / video Lambda path). */
  incomingS3Key?: string;
  /** Server-assigned UUID for this media item. */
  mediaId?: string;
  /** DynamoDB sort key for this media item. */
  sk?: string;
  takenAt?: string;
  safeName?: string;
  committedEventId?: string;
  /** DynamoDB partition key — used to poll /api/media/status. */
  pk?: string;
};

export type UploadQueueState = {
  queue: UploadFileStatus[];
  isVisible: boolean;
  isPanelOpen: boolean;
};

export type UploadQueueAction =
  | { type: "ENQUEUE"; items: UploadFileStatus[] }
  | { type: "PATCH"; fileId: string; patch: Partial<UploadFileStatus> }
  | { type: "FAIL"; fileId: string; errorStage: UploadStage; errorMessage: string }
  | { type: "SUCCEED"; fileId: string }
  | { type: "RETRY"; fileId: string }
  | { type: "DISMISS_DONE" }
  | { type: "TOGGLE_PANEL" }
  | { type: "SHOW" };
