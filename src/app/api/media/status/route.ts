import type { NextRequest } from "next/server";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { getVerifiedUser } from "@/lib/auth-server";
import { ddb } from "@/lib/db/client";
import { apiError, apiOk, requireTable, withErrorHandler } from "@/lib/api";

/**
 * POST /api/media/status
 * Body: { pk: string; sk: string }
 *
 * Checks whether a DynamoDB record exists for the given PK/SK.
 * Used by the upload modal to poll for completion of Lambda-processed HEIC files.
 * Returns { exists: true } once the ProcessHeic Lambda has committed the record.
 *
 * POST (not GET) avoids query-string URL normalization in the OpenNext edge router,
 * which was decoding %23 → # and causing the # to be parsed as a URL fragment,
 * stripping `sk` from the request before the server handler ran.
 */
export const POST = withErrorHandler("POST /api/media/status", async (req: NextRequest) => {
  const user = await getVerifiedUser(req);
  if (!user?.sub) return apiError("Unauthorized", 401);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const pk = typeof body.pk === "string" ? body.pk : null;
  const sk = typeof body.sk === "string" ? body.sk : null;

  if (!pk || !sk) return apiError("pk and sk are required", 400);

  const table = requireTable();
  const result = await ddb.send(
    new GetCommand({
      TableName: table,
      Key: { PK: pk, SK: sk },
      ProjectionExpression: "mediaId, processingStatus",
    })
  );

  const item = result.Item as { processingStatus?: string } | undefined;
  const exists = Boolean(item);
  // Absent field → treat as "ready" (backward compat with pre-Phase-3 records).
  const raw = item?.processingStatus;
  const processingStatus: "processing" | "ready" | "failed" | null = exists
    ? (raw === "processing" ? "processing" : raw === "failed" ? "failed" : "ready")
    : null;

  return apiOk({ exists, processingStatus });
});
