/**
 * Lambda function: process-video
 *
 * Transcodes a raw MOV (or other video) uploaded to S3 under `incoming/videos/`
 * into an MP4 with the moov atom at the front (`-movflags faststart`) so browsers
 * can start playback immediately without buffering the entire file.
 *
 * Steps:
 *   1. Stream raw video from incoming/ to /tmp/input.mov
 *   2. ffmpeg: MOV → MP4 (H.264, AAC, CRF 23, faststart)
 *   3. ffmpeg: extract poster JPEG at 1-second mark
 *   4. Upload MP4  → uploads/videos/{baseName}.mp4
 *   5. Upload poster → previews/videos/{baseName}.jpg
 *   6. CopyObject MOV → originals/videos/{baseName}.mov, then delete from incoming/
 *   7. PutItem DynamoDB (same schema as commit route, mediaType: "video")
 *   8. UpdateCommand event record (photoCount++, coverKey if_not_exists)
 *
 * Input event shape:
 *   { mediaId, sk, incomingKey, eventId, userId, takenAt, filename }
 */

import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
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
import ffmpegStatic from "ffmpeg-static";
import Ffmpeg from "fluent-ffmpeg";

const REGION = process.env.AWS_REGION ?? "us-west-2";
const BUCKET = process.env.S3_BUCKET_NAME!;
const TABLE = process.env.DYNAMO_TABLE_NAME!;

const s3 = new S3Client({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

if (ffmpegStatic) Ffmpeg.setFfmpegPath(ffmpegStatic);

export interface ProcessVideoEvent {
  mediaId: string;
  sk: string;
  incomingKey: string;
  eventId: string;
  userId: string;
  takenAt: string;
  filename: string;
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = Ffmpeg();
    // fluent-ffmpeg doesn't expose raw args cleanly, so build the command via
    // addInput / outputOptions / output.
    const [inputFlag, inputFile, ...rest] = args;
    void inputFlag; // "-i" is implicit in fluent-ffmpeg
    cmd
      .input(inputFile)
      .outputOptions(rest.slice(0, -1)) // everything except the last arg (output path)
      .output(rest[rest.length - 1])
      .on("end", () => resolve())
      .on("error", (err: Error) => reject(err))
      .run();
  });
}

async function streamToFile(stream: Readable, dest: string): Promise<void> {
  const out = fs.createWriteStream(dest);
  await pipeline(stream, out);
}

export const handler = async (event: ProcessVideoEvent): Promise<void> => {
  const { mediaId, sk, incomingKey, eventId, userId, takenAt, filename } = event;

  const log = (step: string, extra?: Record<string, unknown>) =>
    console.log(JSON.stringify({ step, mediaId, incomingKey, ...extra }));

  log("start", { eventId, sk, takenAt, filename });

  const baseName = incomingKey
    .replace(/^incoming\/videos\//, "")
    .replace(/\.[^.]+$/, ""); // strip extension

  const displayKey = `uploads/videos/${baseName}.mp4`;
  const posterKey  = `previews/videos/${baseName}.jpg`;
  const archiveKey = `originals/videos/${baseName}.mov`;

  const inputPath  = "/tmp/input.mov";
  const outputPath = "/tmp/output.mp4";
  const posterPath = "/tmp/poster.jpg";

  // Clean up any leftover /tmp files from a warm container.
  for (const p of [inputPath, outputPath, posterPath]) {
    try { fs.unlinkSync(p); } catch { /* not present */ }
  }

  // 1. Stream raw video from S3 to /tmp.
  const { Body } = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: incomingKey })
  );
  await streamToFile(Body as Readable, inputPath);
  log("s3-read", { bytes: fs.statSync(inputPath).size });

  // 2. Transcode MOV → MP4 faststart.
  await runFfmpeg([
    "-i", inputPath,
    "-c:v", "libx264",
    "-c:a", "aac",
    "-movflags", "+faststart",
    "-preset", "ultrafast",
    "-crf", "23",
    "-y",
    outputPath,
  ]);
  log("transcoded", { bytes: fs.statSync(outputPath).size, key: displayKey });

  // 3. Extract poster frame at 1 second.
  await runFfmpeg([
    "-i", outputPath,
    "-ss", "00:00:01",
    "-frames:v", "1",
    "-q:v", "2",
    "-y",
    posterPath,
  ]);
  log("poster-extracted", { bytes: fs.statSync(posterPath).size, key: posterKey });

  // 4. Upload MP4.
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: displayKey,
    Body: fs.createReadStream(outputPath),
    ContentType: "video/mp4",
    CacheControl: "public, max-age=31536000, immutable",
  }));
  log("mp4-uploaded");

  // 5. Upload poster.
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: posterKey,
    Body: fs.createReadStream(posterPath),
    ContentType: "image/jpeg",
    CacheControl: "public, max-age=31536000, immutable",
  }));
  log("poster-uploaded");

  // 6. Archive original MOV.
  await s3.send(new CopyObjectCommand({
    Bucket: BUCKET,
    CopySource: `${BUCKET}/${incomingKey}`,
    Key: archiveKey,
  }));
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: incomingKey }));
  log("archived", { archiveKey });

  // 7. Commit DynamoDB record.
  const committedAt = new Date().toISOString();
  const safeFilename = path.basename(filename, path.extname(filename)) + ".mp4";

  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK: `EVENT#${eventId}`,
      SK: sk,
      GSI1PK: "PHOTO",   // keeps gallery query working without a schema migration
      GSI1SK: sk,
      mediaId,
      mediaType: "video",
      eventId,
      ownerUserId: userId,
      takenAt,
      uploadedAt: committedAt,
      s3Bucket: BUCKET,
      s3Key: displayKey,
      thumbnailKey: posterKey,
      archiveKey,
      mimeType: "video/mp4",
      filename: safeFilename,
    },
  }));
  log("dynamo-written", { PK: `EVENT#${eventId}`, SK: sk });

  // 8. Update event record.
  await ddb.send(new UpdateCommand({
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
      ":coverKey": posterKey,
      ":owner": userId,
    },
  }));
  log("event-updated");

  // Clean up /tmp to free space for subsequent warm-container invocations.
  for (const p of [inputPath, outputPath, posterPath]) {
    try { fs.unlinkSync(p); } catch { /* already gone */ }
  }

  log("done");
};
