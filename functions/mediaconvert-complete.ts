/**
 * Lambda function: mediaconvert-complete
 *
 * Triggered by EventBridge when a MediaConvert job reaches COMPLETE status.
 * Finalises the DynamoDB record that was written as an early-commit stub
 * (with processingStatus: "processing") by submit-mediaconvert.ts.
 *
 * Steps:
 *   1. Read job context from event.detail.userMetadata
 *   2. Extract the final MP4 S3 key from outputGroupDetails (FILE_GROUP)
 *   3. Extract the HLS master manifest key from outputGroupDetails (HLS_GROUP)
 *   4. UpdateItem: set s3Key, hlsKey, processingStatus="ready", mimeType, filename
 *      NOTE: does NOT increment photoCount — already done at early commit.
 *      Uses UpdateItem (not PutItem) to preserve thumbnailKey and other fields.
 *   5. Copy incoming/ file → originals/videos/ for archival
 *   6. Delete incoming/ file
 *
 * EventBridge rule (in sst.config.ts):
 *   source:      ["aws.mediaconvert"]
 *   detail-type: ["MediaConvert Job State Change"]
 *   detail:      { status: ["COMPLETE"] }
 */

import path from "path";
import {
  S3Client,
  CopyObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION ?? "us-west-2";
const TABLE  = process.env.DYNAMO_TABLE_NAME!;

const s3  = new S3Client({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

// ── EventBridge event types ───────────────────────────────────────────────────

interface OutputDetail {
  outputFilePaths: string[];
  durationInMs?: number;
  videoDetails?: { widthInPx: number; heightInPx: number };
}

interface OutputGroupDetail {
  type: "FILE_GROUP" | "HLS_GROUP" | string;
  outputDetails: OutputDetail[];
  /** Present on HLS_GROUP — contains the master manifest S3 URI. */
  playlistFilePaths?: string[];
}

interface MediaConvertCompleteEvent {
  source: "aws.mediaconvert";
  "detail-type": "MediaConvert Job State Change";
  detail: {
    status: "COMPLETE" | "ERROR";
    jobId: string;
    outputGroupDetails: OutputGroupDetail[];
    userMetadata: {
      mediaId: string;
      sk: string;
      eventId: string;
      userId: string;
      takenAt: string;
      filename: string;
      incomingKey: string;
      bucket: string;
    };
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Strips the `s3://{bucket}/` prefix from a full S3 URI, returning only the key.
 * Returns `undefined` if the URI is absent or malformed.
 */
function uriToKey(uri: string | undefined, bucket: string): string | undefined {
  if (!uri) return undefined;
  const prefix = `s3://${bucket}/`;
  return uri.startsWith(prefix) ? uri.slice(prefix.length) : undefined;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export const handler = async (event: MediaConvertCompleteEvent): Promise<void> => {
  const { detail } = event;
  const { userMetadata, outputGroupDetails, jobId } = detail;
  const { mediaId, sk, eventId, incomingKey, bucket, filename } = userMetadata;

  const log = (step: string, extra?: Record<string, unknown>) =>
    console.log(JSON.stringify({ step, mediaId, jobId, ...extra }));

  log("start", { eventId, sk, incomingKey, status: detail.status });

  // ── 0. Handle ERROR status — mark record as failed and bail out ───────────
  if (detail.status === "ERROR") {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: `EVENT#${eventId}`, SK: sk },
        UpdateExpression: "SET processingStatus = :failed, updatedAt = :now",
        ExpressionAttributeValues: {
          ":failed": "failed",
          ":now": new Date().toISOString(),
        },
      })
    );
    log("marked-failed", { jobId });
    return;
  }

  // ── 1. Extract output keys from EventBridge payload ───────────────────────

  const fileGroup = outputGroupDetails.find((g) => g.type === "FILE_GROUP");
  const hlsGroup  = outputGroupDetails.find((g) => g.type === "HLS_GROUP");

  const mp4Uri    = fileGroup?.outputDetails?.[0]?.outputFilePaths?.[0];
  const hlsUri    = hlsGroup?.playlistFilePaths?.[0];

  const s3Key  = uriToKey(mp4Uri,  bucket);
  const hlsKey = uriToKey(hlsUri,  bucket);

  if (!s3Key) {
    throw new Error(`No MP4 output path in job ${jobId} — outputGroupDetails: ${JSON.stringify(outputGroupDetails)}`);
  }

  log("keys", { s3Key, hlsKey });

  // ── 2. UpdateItem — patch the early-commit stub ───────────────────────────
  // Use UpdateItem (not PutItem) so thumbnailKey and other fields written by
  // the early commit are preserved. Never increment photoCount here — it was
  // already incremented when the early commit called /api/media/commit.

  const baseName = path.basename(filename, path.extname(filename)) + ".mp4";
  const updatedAt = new Date().toISOString();

  // ── 3a. Compute archiveKey before the UpdateCommand so it can be written to DB

  // Preserve the original file extension (e.g. .mov, .MP4, .mp4) rather than
  // hardcoding .mov — iPhone videos are commonly .MOV or .MP4.
  const origExt    = path.extname(incomingKey) || ".mov";
  const origBase   = path.basename(incomingKey, path.extname(incomingKey));
  const archiveKey = `originals/videos/${origBase}${origExt}`;

  const updateExpr = hlsKey
    ? "SET s3Key = :s3Key, hlsKey = :hlsKey, archiveKey = :archiveKey, processingStatus = :ready, mimeType = :mime, filename = :fn, updatedAt = :now"
    : "SET s3Key = :s3Key, archiveKey = :archiveKey, processingStatus = :ready, mimeType = :mime, filename = :fn, updatedAt = :now";

  const exprValues: Record<string, string> = {
    ":s3Key":      s3Key,
    ":archiveKey": archiveKey,
    ":ready":      "ready",
    ":mime":       "video/mp4",
    ":fn":         baseName,
    ":now":        updatedAt,
    ...(hlsKey ? { ":hlsKey": hlsKey } : {}),
  };

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `EVENT#${eventId}`, SK: sk },
      UpdateExpression: updateExpr,
      ExpressionAttributeValues: exprValues,
    })
  );

  log("dynamo-updated", { PK: `EVENT#${eventId}`, SK: sk });

  // ── 3. Archive the original incoming file ─────────────────────────────────

  try {
    await s3.send(
      new CopyObjectCommand({
        Bucket: bucket,
        CopySource: `${bucket}/${incomingKey}`,
        Key: archiveKey,
      })
    );
    log("archived", { archiveKey });

    await s3.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: incomingKey })
    );
    log("incoming-deleted");
  } catch (err) {
    // Archival is best-effort — if the copy fails (e.g. file already deleted),
    // log it but don't fail the whole handler. The DynamoDB record is already
    // updated and the gallery will show the video as ready.
    console.error("Archive/delete of incoming file failed (non-fatal):", err);
  }

  log("done");
};
