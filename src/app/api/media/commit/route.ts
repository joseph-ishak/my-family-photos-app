// src/app/api/media/commit/route.ts
//
// Called by the client after a successful S3 PUT to confirm an upload.
// This is the second half of a two-phase upload:
//
//   Phase 1 — POST /api/upload-url  → presigned S3 URL + metadata tokens
//   Phase 2 — PUT <signedUrl>        → file lands in S3
//   Phase 3 — POST /api/media/commit → HeadObject verifies file, DynamoDB record written
//
// By deferring the DynamoDB write until after S3 confirms the file exists,
// we avoid orphaned records caused by interrupted or failed S3 uploads.

import type { NextRequest } from "next/server";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { getVerifiedUser } from "@/lib/auth-server";
import { ddb, s3 } from "@/lib/db/client";
import { requireTable, requireBucket, apiError, apiOk, withErrorHandler } from "@/lib/api";
import { normalizeEventId } from "@/lib/utils";

/**
 * Type guard for the `mediaType` field. Returns `false` for any value other
 * than the two recognised strings so the caller can return a 400.
 */
function isValidMediaType(v: unknown): v is "photo" | "video" {
  return v === "photo" || v === "video";
}

export const POST = withErrorHandler("POST /api/media/commit", async (req: NextRequest) => {
  const user = await getVerifiedUser(req);
  if (!user?.sub) {
    return apiError("Unauthorized", 401);
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));

  const { mediaId, sk, s3Key, eventId, takenAt, mimeType, filename, mediaType, thumbnailKey, archiveKey } = body as {
    mediaId?: string;
    sk?: string;
    s3Key?: string;
    eventId?: string;
    takenAt?: string;
    mimeType?: string;
    filename?: string;
    mediaType?: unknown;
    thumbnailKey?: string;
    /** S3 key for the preserved HEIC/HEIF original (optional — only for HEIC uploads). */
    archiveKey?: string;
  };

  if (!mediaId || !sk || !s3Key || !eventId || !takenAt || !mimeType || !filename) {
    return apiError("Missing required fields", 400);
  }

  // Normalize eventId the same way upload-url does — rejects whitespace-only
  // values and ensures the PK matches the event record exactly.
  const safeEventId = normalizeEventId(eventId);
  if (!safeEventId) {
    return apiError("Invalid eventId", 400);
  }

  if (!isValidMediaType(mediaType)) {
    return apiError("Invalid mediaType", 400);
  }

  // Verify the s3Key is for this mediaId — prevents a client from committing
  // a key it didn't receive from /api/upload-url.
  if (!s3Key.includes(mediaId)) {
    return apiError("s3Key does not match mediaId", 400);
  }

  // Verify the SK is well-formed and belongs to this mediaId.
  if (!sk.startsWith("MEDIA#") || !sk.includes(mediaId)) {
    return apiError("Invalid sk", 400);
  }

  const bucket = requireBucket();
  const table = requireTable();

  // Confirm the file actually landed in S3 before writing any metadata.
  // If the client lost connection mid-upload, HeadObject returns 404 and we
  // return a 422 so the client can retry rather than silently creating a
  // broken record.
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: s3Key }));
  } catch (err: unknown) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404) {
      return apiError(
        "File not found in storage — the upload may not have completed. Please retry.",
        422
      );
    }
    throw err;
  }

  const committedAt = new Date().toISOString();
  // Only use thumbnailKey as the cover — never the raw s3Key (which is not CDN-served).
  const coverKey = thumbnailKey ?? null;

  await ddb.send(
    new PutCommand({
      TableName: table,
      Item: {
        PK: `EVENT#${safeEventId}`,
        SK: sk,

        GSI1PK: "PHOTO",
        GSI1SK: sk,

        mediaId,
        mediaType,
        eventId: safeEventId,
        ownerUserId: user.sub,
        takenAt,
        uploadedAt: committedAt,
        s3Bucket: bucket,
        s3Key,
        thumbnailKey: thumbnailKey ?? undefined,
        // archiveKey uses if_not_exists semantics at the expression level, but
        // since this is a PutCommand (full item replacement), we simply omit the
        // field when absent so existing archiveKeys aren't overwritten on re-commit.
        ...(archiveKey ? { archiveKey } : {}),
        mimeType,
        filename,
      },
    })
  );

  // coverKey uses if_not_exists so the first uploaded photo's thumbnail becomes
  // the event cover and stays stable as more photos are added.
  const coverExpression = coverKey
    ? "coverKey = if_not_exists(coverKey, :coverKey), "
    : "";

  await ddb.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: "EVENT", SK: `EVENT#${safeEventId}` },
      UpdateExpression:
        `ADD photoCount :one SET updatedAt = :now, createdAt = if_not_exists(createdAt, :now), #name = if_not_exists(#name, :name), eventId = if_not_exists(eventId, :eventId), ${coverExpression}ownerUserId = if_not_exists(ownerUserId, :owner)`,
      ExpressionAttributeNames: { "#name": "name" },
      ExpressionAttributeValues: {
        ":one": 1,
        ":now": committedAt,
        ":name": safeEventId,
        ":eventId": safeEventId,
        ...(coverKey ? { ":coverKey": coverKey } : {}),
        ":owner": user.sub,
      },
    })
  );

  return apiOk({ mediaId, committed: true });
});
