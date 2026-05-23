/**
 * Represents a single photo or video item as returned by `/api/photos`.
 *
 * `key` is the primary client-side identifier and matches `s3Key` for original
 * uploads. `pk` and `sk` are the raw DynamoDB composite key components —
 * required when performing delete or edit operations.
 */
export type Photo = {
  /** Client-side identifier; equal to the S3 object key. */
  key: string;
  /** Pre-signed S3 URL for the full-resolution original. Expires after 1 hour. */
  url: string;
  /** Event the photo belongs to (empty / absent for the default event). */
  eventId?: string;
  /** ISO 8601 timestamp of when the photo was taken. */
  takenAt?: string;
  /** Cognito sub of the user who uploaded this item. */
  ownerUserId?: string;
  /** Display name of the owner, resolved from their profile. */
  ownerNickname?: string | null;
  /** DynamoDB partition key — required for delete/edit operations. */
  pk?: string;
  /** DynamoDB sort key — required for delete/edit operations. */
  sk?: string;
  /** S3 object key for the original upload. */
  s3Key?: string;
  /** MIME type as reported at upload time (e.g. `"image/jpeg"`, `"video/mp4"`). */
  mimeType?: string;
  /** Normalised media type derived from `mimeType` or the explicit `mediaType` field. */
  mediaType?: "photo" | "video";
  /** S3 key for the compressed preview/thumbnail. */
  thumbnailKey?: string;
  /** CDN URL for the compressed preview. Prefer this over `url` for thumbnails. */
  thumbnailUrl?: string;
  /**
   * S3 key for the original HEIC/HEIF file, stored under `originals/`.
   * Only present on photos that were originally uploaded as HEIC.
   * Enables a future "Download Original" feature to retrieve the lossless source.
   */
  archiveKey?: string;
  /** Stable identifier for the media item — used for queue membership checks. */
  mediaId?: string;
  /**
   * Server-side processing status. Absent or `"ready"` means the media is
   * fully transcoded and ready to play/view. `"processing"` means a Lambda or
   * MediaConvert job is still running — the card shows a progress ring.
   * `"failed"` means the MediaConvert job errored and the user can retry.
   */
  processingStatus?: "processing" | "ready" | "failed";
  /**
   * S3 key of the raw incoming file — preserved so the retry endpoint can
   * re-submit a failed MediaConvert job without the user needing to re-upload.
   */
  incomingKey?: string;
  /**
   * S3 key for the HLS adaptive bitrate manifest. Only present on videos
   * transcoded via MediaConvert. Prefer this over `s3Key` for playback when
   * available (enables instant-start via segment streaming).
   */
  hlsKey?: string;
  /**
   * CDN URL for the HLS master manifest. Derived from `hlsKey` via the
   * previews CDN. Use this as the `src` for `hls.js` / native HLS playback.
   * Only present when `hlsKey` is set.
   */
  hlsUrl?: string;
};
