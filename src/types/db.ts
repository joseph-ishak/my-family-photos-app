/**
 * TypeScript interfaces for DynamoDB record shapes.
 *
 * These mirror the actual item structures stored in the table. Using these
 * instead of `any[]` casts ensures that typos in attribute names are caught
 * at compile time rather than silently returning undefined at runtime.
 */

export interface MediaRecord {
  PK: string; // EVENT#<eventId>
  SK: string; // MEDIA#<takenAt>#<mediaId>
  GSI1PK: "PHOTO";
  GSI1SK: string; // MEDIA#<takenAt>#<mediaId>
  mediaId: string;
  mediaType: "photo" | "video";
  eventId: string;
  ownerUserId: string;
  takenAt: string;
  uploadedAt: string;
  s3Key: string;
  thumbnailKey?: string;
  /**
   * S3 key for the original HEIC/HEIF file preserved before JPEG conversion.
   * Only present on photos that were originally uploaded as HEIC.
   * Stored under the `originals/` prefix (e.g. `originals/photos/{id}_IMG.HEIC`).
   */
  archiveKey?: string;
  mimeType: string;
  filename: string;
  s3Bucket?: string;
  /**
   * Lifecycle status of server-side processing (Lambda or MediaConvert).
   * Absent on older records — treat as `"ready"`.
   * Set to `"processing"` on early commit; updated to `"ready"` by the completion Lambda,
   * or `"failed"` if MediaConvert emits an ERROR event.
   */
  processingStatus?: "processing" | "ready" | "failed";
  /**
   * S3 key of the raw uploaded file in the `incoming/` prefix.
   * Written at early-commit time and preserved so the retry endpoint can
   * re-submit a failed MediaConvert job without requiring a re-upload.
   */
  incomingKey?: string;
  /**
   * S3 key for the HLS manifest (e.g. `hls/{mediaId}/index.m3u8`).
   * Only present on videos transcoded via MediaConvert with HLS output enabled.
   */
  hlsKey?: string;
}

export interface EventRecord {
  PK: "EVENT";
  SK: string; // EVENT#<eventId>
  eventId: string;
  name: string;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
  photoCount: number;
  coverKey?: string;
}

export interface UserProfileRecord {
  PK: string; // USER#<sub>
  SK: "PROFILE";
  nickname?: string;
  avatarKey?: string;
  email?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface GroupRecord {
  PK: "GROUP";
  SK: string; // GROUP#<groupId>
  groupId: string;
  name: string;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface GroupMemberRecord {
  PK: string; // GROUP#<groupId>
  SK: string; // MEMBER#<userId>
  groupId: string;
  userId: string;
  role: "owner" | "admin" | "member";
  createdAt: string;
}

export interface UserGroupRecord {
  PK: string; // USER#<sub>
  SK: string; // GROUP#<groupId>
  groupId: string;
  name: string;
  role: "owner" | "admin" | "member";
  createdAt: string;
}

export interface EventShareRecord {
  PK: string; // EVENT#<eventId>
  SK: string; // SHARE#GROUP#<groupId>
  eventId: string;
  groupId: string;
  sharedAt: string;
  sharedByUserId: string;
}
