import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  PutCommand,
  UpdateCommand,
  DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { getVerifiedUser } from "@/lib/auth-server";

const s3 = new S3Client({ region: "us-west-2" });
const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: "us-west-2" })
);

function isValidMediaType(value: unknown): value is "photo" | "video" {
  return value === "photo" || value === "video";
}

function isValidKind(value: unknown): value is "original" | "preview" {
  return value === "original" || value === "preview";
}

export async function POST(req: NextRequest) {
  const user = await getVerifiedUser(req);
  if (!user?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({} as any));

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

  const thumbnailKeyFromClient: string | undefined =
    typeof body?.thumbnailKey === "string" && body.thumbnailKey.trim()
      ? body.thumbnailKey.trim()
      : undefined;

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

  const bucket = process.env.S3_BUCKET_NAME!;
  const table = process.env.DYNAMO_TABLE_NAME!;

  if (!bucket || !table) {
    return NextResponse.json(
      { error: "Server config missing" },
      { status: 500 }
    );
  }

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

  await ddb.send(
    new PutCommand({
      TableName: table,
      Item: {
        PK: `EVENT#${eventName}`,
        SK: sk,

        GSI1PK: "PHOTO",
        GSI1SK: sk,

        mediaId,
        mediaType,
        eventId: eventName,
        ownerUserId: user.sub,
        takenAt: timePart,
        uploadedAt,
        s3Bucket: bucket,
        s3Key,
        thumbnailKey: thumbnailKeyFromClient,
        mimeType: filetype,
        filename: safeName,
      },
    })
  );

  const coverKey = thumbnailKeyFromClient ?? s3Key;

  await ddb.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: "EVENT", SK: `EVENT#${eventName}` },
      UpdateExpression:
        "ADD photoCount :one SET updatedAt = :now, createdAt = if_not_exists(createdAt, :now), #name = if_not_exists(#name, :name), eventId = if_not_exists(eventId, :eventId), coverKey = :coverKey",
      ExpressionAttributeNames: {
        "#name": "name",
      },
      ExpressionAttributeValues: {
        ":one": 1,
        ":now": uploadedAt,
        ":name": eventName,
        ":eventId": eventName,
        ":coverKey": coverKey,
      },
    })
  );

  return NextResponse.json({ signedUrl, s3Key, mediaType, kind, sk });
}
