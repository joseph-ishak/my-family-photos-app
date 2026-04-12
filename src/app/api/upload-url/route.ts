// src/app/api/upload-url/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";
import { getVerifiedUser } from "@/lib/auth-server";
import { s3 } from "@/lib/db/client";
import { requireBucket, withErrorHandler } from "@/lib/api";

function isValidMediaType(value: unknown): value is "photo" | "video" {
  return value === "photo" || value === "video";
}

function isValidKind(value: unknown): value is "original" | "preview" {
  return value === "original" || value === "preview";
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
  const kind: "original" | "preview" = isValidKind(kindRaw)
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

  const mediaId = uuidv4();
  const uploadedAt = new Date().toISOString();
  const timePart = takenAt ?? uploadedAt;
  const sk = `MEDIA#${timePart}#${mediaId}`;

  const bucket = requireBucket();

  const basePrefix = kind === "preview" ? "previews" : "uploads";
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

  if (kind === "preview") {
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
