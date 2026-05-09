// src/app/api/download-url/route.ts

/**
 * GET /api/download-url?key=<s3Key>
 *
 * Generates a short-lived (5-minute) presigned S3 GetObject URL for the given
 * key. The URL includes a `Content-Disposition: attachment` response header so
 * that navigating to it triggers a browser file download rather than an
 * in-browser preview.
 *
 * Security:
 *   - Requires a valid session (Cognito JWT).
 *   - Only keys under `uploads/`, `originals/`, or `previews/` are permitted.
 *     This prevents the endpoint from being used to read arbitrary S3 objects
 *     (e.g. SST state files or Lambda zips stored in the same bucket).
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getVerifiedUser } from "@/lib/auth-server";
import { s3 } from "@/lib/db/client";
import { requireBucket, withErrorHandler } from "@/lib/api";

/** Allowed S3 key prefixes. Anything outside these is rejected with 400. */
const ALLOWED_PREFIXES = ["uploads/", "originals/", "previews/"];

/**
 * Strips the leading `{uuid}_` segment from the filename component of an S3
 * key so the downloaded file gets a clean human-readable name.
 *
 * Example:
 *   `originals/photos/3f2a1b4c-..._IMG_1408.HEIC` → `IMG_1408.HEIC`
 */
function filenameFromKey(key: string): string {
  const basename = key.split("/").pop() ?? "download";
  // UUIDs are 36 chars: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  return basename.replace(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_/i,
    ""
  );
}

export const GET = withErrorHandler("GET /api/download-url", async (req: NextRequest) => {
  const user = await getVerifiedUser(req);
  if (!user?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const key = searchParams.get("key");

  if (!key) {
    return NextResponse.json({ error: "key is required" }, { status: 400 });
  }

  if (!ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });
  }

  const filename = filenameFromKey(key);
  const bucket = requireBucket();

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    // Forces the browser to download the file rather than open it inline.
    ResponseContentDisposition: `attachment; filename="${filename}"`,
  });

  const url = await getSignedUrl(s3, command, { expiresIn: 300 });

  return NextResponse.json({ url });
});
