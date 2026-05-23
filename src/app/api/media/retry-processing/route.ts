import type { NextRequest } from "next/server";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { getVerifiedUser } from "@/lib/auth-server";
import { ddb, s3 } from "@/lib/db/client";
import { requireTable, requireBucket, apiError, apiOk, withErrorHandler } from "@/lib/api";

const lambda = new LambdaClient({ region: process.env.S3_REGION ?? "us-west-2" });

/**
 * POST /api/media/retry-processing
 *
 * Retries a failed or stuck MediaConvert job for a video that was already
 * uploaded. This is called when a gallery card shows processingStatus
 * "failed" or "processing" and the item is no longer in the active upload
 * queue (e.g. after a page refresh).
 *
 * Steps:
 *   1. Look up the DynamoDB record by (pk, sk) to get incomingKey + metadata
 *   2. Verify the caller owns the record
 *   3. HeadObject to confirm the incoming file still exists in S3
 *   4. Reset processingStatus → "processing" in DynamoDB
 *   5. Fire-and-forget invoke of SubmitMediaConvert
 */
export const POST = withErrorHandler("POST /api/media/retry-processing", async (req: NextRequest) => {
  const user = await getVerifiedUser(req);
  if (!user?.sub) return apiError("Unauthorized", 401);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const { pk, sk } = body as { pk?: string; sk?: string };

  if (!pk || !sk) return apiError("Missing pk or sk", 400);

  const table = requireTable();
  const bucket = requireBucket();

  // ── 1. Fetch the record ──────────────────────────────────────────────────
  const { Item } = await ddb.send(
    new GetCommand({
      TableName: table,
      Key: { PK: pk, SK: sk },
    })
  );

  if (!Item) return apiError("Media not found", 404);

  // ── 2. Ownership check ───────────────────────────────────────────────────
  if (Item.ownerUserId !== user.sub) return apiError("Forbidden", 403);

  const { mediaId, eventId, takenAt, filename } = Item as {
    mediaId?: string;
    eventId?: string;
    takenAt?: string;
    filename?: string;
  };

  if (!mediaId || !eventId || !takenAt || !filename) {
    return apiError("Record is missing required fields", 500);
  }

  // Prefer the explicit incomingKey written at early-commit time.
  // Fall back to s3Key when it still points to the incoming/ prefix — this
  // covers videos uploaded before the incomingKey field was added, where the
  // failure Lambda left s3Key unchanged (it only sets processingStatus="failed").
  const rawS3Key = Item.s3Key as string | undefined;
  const incomingKey: string | undefined =
    (Item.incomingKey as string | undefined) ??
    (rawS3Key?.startsWith("incoming/") ? rawS3Key : undefined);

  if (!incomingKey) {
    return apiError(
      "Original file is no longer available. Please delete this item and re-upload.",
      410
    );
  }

  // ── 3. Confirm incoming file still exists in S3 ──────────────────────────
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: incomingKey }));
  } catch {
    return apiError(
      "Original file is no longer available. Please delete this item and re-upload.",
      410
    );
  }

  // ── 4. Reset processingStatus → "processing" ─────────────────────────────
  await ddb.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: pk, SK: sk },
      UpdateExpression: "SET processingStatus = :processing, updatedAt = :now",
      ExpressionAttributeValues: {
        ":processing": "processing",
        ":now": new Date().toISOString(),
      },
    })
  );

  // ── 5. Re-invoke SubmitMediaConvert (fire-and-forget) ────────────────────
  const functionName = process.env.SUBMIT_MEDIACONVERT_FUNCTION_NAME;
  if (!functionName) return apiError("Video processing not configured", 500);

  await lambda.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: "Event",
      Payload: Buffer.from(
        JSON.stringify({
          mediaId,
          sk,
          incomingKey,
          eventId,
          userId: user.sub,
          takenAt,
          filename,
        })
      ),
    })
  );

  return apiOk({ retrying: true });
});
