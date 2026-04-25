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
};
