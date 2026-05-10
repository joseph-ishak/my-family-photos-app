/**
 * Lambda function: process-heic
 *
 * Converts a raw HEIC/HEIF file that was uploaded to S3 under `incoming/photos/`
 * into a display JPEG and a preview thumbnail using Sharp (native C++ codec —
 * orders of magnitude faster than heic2any in the browser).
 *
 * Invoked asynchronously by POST /api/media/process after the client has PUT
 * the raw HEIC to S3.  On completion it writes the DynamoDB record using the
 * same schema as POST /api/media/commit, then moves the HEIC to `originals/`
 * as the lossless archive.
 *
 * Input event shape:
 *   { mediaId, sk, incomingKey, eventId, userId, takenAt, filename }
 */

import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { Readable } from "stream";
import sharp from "sharp";
import convert from "heic-convert";

const REGION = process.env.AWS_REGION ?? "us-west-2";
const BUCKET = process.env.S3_BUCKET_NAME!;
const TABLE = process.env.DYNAMO_TABLE_NAME!;

const s3 = new S3Client({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

const MAX_DISPLAY_PX = 2400;
const MAX_PREVIEW_PX = 1200;
const DISPLAY_QUALITY = 90;
const PREVIEW_QUALITY = 78;

export interface ProcessHeicEvent {
  mediaId: string;
  sk: string;
  incomingKey: string;
  eventId: string;
  userId: string;
  takenAt: string;
  filename: string;
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

export const handler = async (event: ProcessHeicEvent): Promise<void> => {
  const { mediaId, sk, incomingKey, eventId, userId, takenAt, filename } = event;

  const log = (step: string, extra?: Record<string, unknown>) =>
    console.log(JSON.stringify({ step, mediaId, incomingKey, ...extra }));

  log("start", { eventId, sk, takenAt, filename });

  const baseName = incomingKey
    .replace(/^incoming\/photos\//, "")
    .replace(/\.(heic|heif)$/i, "");

  const displayKey = `uploads/photos/${baseName}.jpg`;
  const previewKey = `previews/photos/${baseName}.jpg`;
  const archiveKey = `originals/photos/${baseName}.heic`;

  // 1. Read raw HEIC from S3.
  const { Body } = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: incomingKey })
  );
  const inputBuffer = await streamToBuffer(Body as Readable);
  log("s3-read", { bytes: inputBuffer.byteLength });

  // 2. Decode HEIC → PNG using heic-convert (WASM libheif with HEVC/H.265 support).
  //    Sharp's prebuilt Lambda binary excludes HEVC decoding due to patent concerns.
  //    heic-decode internally iterates via Symbol.iterator so it needs a Uint8Array/Buffer,
  //    not a raw ArrayBuffer — cast to satisfy the @types declaration.
  const decodedBuffer = Buffer.from(
    await convert({ buffer: inputBuffer as unknown as ArrayBuffer, format: "PNG" })
  );
  log("heic-decoded", { bytes: decodedBuffer.byteLength });

  // 3. Generate display JPEG (full res, capped at MAX_DISPLAY_PX on longest edge).
  const displayBuffer = await sharp(decodedBuffer)
    .rotate()
    .resize(MAX_DISPLAY_PX, MAX_DISPLAY_PX, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: DISPLAY_QUALITY })
    .toBuffer();
  log("display-jpeg", { bytes: displayBuffer.byteLength, key: displayKey });

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: displayKey,
      Body: displayBuffer,
      ContentType: "image/jpeg",
    })
  );
  log("display-uploaded");

  // 4. Generate preview thumbnail (max MAX_PREVIEW_PX on longest edge).
  const previewBuffer = await sharp(decodedBuffer)
    .rotate()
    .resize(MAX_PREVIEW_PX, MAX_PREVIEW_PX, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: PREVIEW_QUALITY })
    .toBuffer();
  log("preview-jpeg", { bytes: previewBuffer.byteLength, key: previewKey });

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: previewKey,
      Body: previewBuffer,
      ContentType: "image/jpeg",
      CacheControl: "public, max-age=31536000, immutable",
    })
  );
  log("preview-uploaded");

  // 5. Archive HEIC: copy to originals/, then delete from incoming/.
  await s3.send(
    new CopyObjectCommand({
      Bucket: BUCKET,
      CopySource: `${BUCKET}/${incomingKey}`,
      Key: archiveKey,
    })
  );
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: incomingKey }));
  log("archived", { archiveKey });

  // 6. Commit DynamoDB record (same schema as POST /api/media/commit).
  const committedAt = new Date().toISOString();
  const safeFilename = filename.replace(/\.(heic|heif)$/i, ".jpg");

  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        PK: `EVENT#${eventId}`,
        SK: sk,
        GSI1PK: "PHOTO",
        GSI1SK: sk,
        mediaId,
        mediaType: "photo",
        eventId,
        ownerUserId: userId,
        takenAt,
        uploadedAt: committedAt,
        s3Bucket: BUCKET,
        s3Key: displayKey,
        thumbnailKey: previewKey,
        archiveKey,
        mimeType: "image/jpeg",
        filename: safeFilename,
      },
    })
  );
  log("dynamo-written", { PK: `EVENT#${eventId}`, SK: sk });

  // 7. Update event record (same as commit route: photoCount++, coverKey if_not_exists).
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: "EVENT", SK: `EVENT#${eventId}` },
      UpdateExpression:
        "ADD photoCount :one SET updatedAt = :now, createdAt = if_not_exists(createdAt, :now), #name = if_not_exists(#name, :name), eventId = if_not_exists(eventId, :eventId), coverKey = if_not_exists(coverKey, :coverKey), ownerUserId = if_not_exists(ownerUserId, :owner)",
      ExpressionAttributeNames: { "#name": "name" },
      ExpressionAttributeValues: {
        ":one": 1,
        ":now": committedAt,
        ":name": eventId,
        ":eventId": eventId,
        ":coverKey": previewKey,
        ":owner": userId,
      },
    })
  );
  log("event-updated");
  log("done");
};
