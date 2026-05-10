// src/app/api/upload-url/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";
import { getVerifiedUser } from "@/lib/auth-server";
import { s3 } from "@/lib/db/client";
import { requireBucket, withErrorHandler } from "@/lib/api";

/**
 * POST /api/upload-url
 *
 * Phase 1 of the two-phase upload flow: generates a pre-signed S3 PutObject
 * URL and returns the metadata tokens the client needs for Phase 3.
 *
 * Flow:
 *   1. POST /api/upload-url  → presigned S3 URL + metadata tokens
 *   2. PUT  <signedUrl>      → client uploads file directly to S3
 *   3. POST /api/media/commit → HeadObject verifies file, DynamoDB record written
 *
 * For `kind: "preview"` uploads (thumbnails), the response contains only
 * `{ signedUrl, s3Key, mediaType, kind }` — no commit step is needed because
 * preview keys are referenced by the original's commit request.
 */

/**
 * Type guard that checks whether a value is a valid media type string.
 * Defaults to `"photo"` in the caller when the value is not recognised.
 */
function isValidMediaType(value: unknown): value is "photo" | "video" {
  return value === "photo" || value === "video";
}

/**
 * Type guard that checks whether a value is a valid upload kind.
 * - `"original"` — user-captured display file (JPEG for HEIC, raw otherwise).
 * - `"preview"`  — server-generated 480 px thumbnail.
 * - `"archive"`  — original HEIC/HEIF stored at full quality under `originals/`.
 * - `"incoming"` — raw HEIC awaiting Lambda conversion; stored under `incoming/`.
 */
function isValidKind(value: unknown): value is "original" | "preview" | "archive" | "incoming" {
  return value === "original" || value === "preview" || value === "archive" || value === "incoming";
}

export const POST = withErrorHandler("POST /api/upload-url", async (req: NextRequest) => {
  const user = await getVerifiedUser(req);
  if (!user?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));

  const filename = body?.filename;
  const filetype = body?.filetype;
  const eventIdRaw = body?.eventId;
  const takenAt = body?.takenAt;

  const mediaTypeRaw = body?.mediaType;
  const mediaType: "photo" | "video" = isValidMediaType(mediaTypeRaw)
    ? mediaTypeRaw
    : "photo";

  const kindRaw = body?.kind;
  const kind: "original" | "preview" | "archive" | "incoming" = isValidKind(kindRaw)
    ? kindRaw
    : "original";

  if (!filename || !filetype) {
    return NextResponse.json(
      { error: "filename and filetype are required" },
      { status: 400 }
    );
  }

  const safeName = String(filename ?? "upload")
    .replace(/[^a-zA-Z0-9._]/g, "_")
    .slice(0, 200);

  const eventName = String(eventIdRaw ?? "default").trim() || "default";

  // For archive uploads, reuse the mediaId from the original request so both
  // S3 keys share the same UUID (e.g. uploads/photos/{id}_IMG.jpg and
  // originals/photos/{id}_IMG.HEIC). Fall back to a fresh UUID otherwise.
  const clientMediaId = typeof body?.mediaId === "string" ? body.mediaId.trim() : "";
  const mediaId = kind === "archive" && clientMediaId ? clientMediaId : uuidv4();
  const uploadedAt = new Date().toISOString();

  // Validate and normalize client-supplied takenAt to a valid ISO8601 string.
  // An invalid value (e.g. "not-a-date") would produce a malformed SK and break
  // chronological sort order in DynamoDB. Fall back to server time if invalid.
  let timePart = uploadedAt;
  if (takenAt && typeof takenAt === "string") {
    const parsed = new Date(takenAt);
    if (!Number.isNaN(parsed.getTime())) {
      timePart = parsed.toISOString();
    }
  }

  const sk = `MEDIA#${timePart}#${mediaId}`;

  const bucket = requireBucket();

  const basePrefix =
    kind === "preview"
      ? "previews"
      : kind === "archive"
      ? "originals"
      : kind === "incoming"
      ? "incoming"
      : "uploads";
  const typePrefix = mediaType === "video" ? "videos" : "photos";
  const s3Key = `${basePrefix}/${typePrefix}/${mediaId}_${safeName}`;

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: s3Key,
    ContentType: filetype,
    ...(kind === "preview"
      ? { CacheControl: "public, max-age=31536000, immutable" }
      : {}),
  });

  const signedUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

  // Preview and archive uploads don't need a commit step — the commit request
  // for the original will reference the preview/archive keys directly.
  // Incoming (raw HEIC for Lambda processing) returns the same full metadata as
  // "original" so the client can pass everything to POST /api/media/process.
  if (kind === "preview" || kind === "archive") {
    return NextResponse.json({ signedUrl, s3Key, mediaType, kind });
  }

  // For originals: return the metadata needed for the commit step.
  // The DynamoDB record is intentionally NOT written here — it is only written
  // after the client confirms the S3 upload succeeded (POST /api/media/commit).
  // This prevents orphaned DynamoDB records when S3 uploads fail mid-transfer.
  return NextResponse.json({
    signedUrl,
    s3Key,
    mediaType,
    kind,
    mediaId,
    sk,
    takenAt: timePart,
    filename: safeName,
    eventId: eventName,
  });
});
