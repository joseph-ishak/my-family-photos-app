import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { PutCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { getVerifiedUser } from "@/lib/auth-server";

const s3 = new S3Client({ region: "us-west-2" });
const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: "us-west-2" })
);

export async function POST(req: NextRequest) {
  const user = await getVerifiedUser(req);
  if (!user?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { filename, filetype, eventId, takenAt } = await req.json();

  const photoId = uuidv4();
  const uploadedAt = new Date().toISOString();

  const safeName = String(filename ?? "upload")
    .replace(/[^a-zA-Z0-9._]/g, "_")
    .slice(0, 200);

  const eventName = String(eventId ?? "default").trim() || "default";
  const s3Key = `uploads/${photoId}_${safeName}`;

  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME!,
    Key: s3Key,
    ContentType: filetype,
  });

  const signedUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

  const sk = `PHOTO#${takenAt ?? uploadedAt}#${photoId}`;

  await ddb.send(
    new PutCommand({
      TableName: process.env.DYNAMO_TABLE_NAME!,
      Item: {
        PK: `EVENT#${eventName}`,
        SK: sk,

        GSI1PK: "PHOTO",
        GSI1SK: sk,

        photoId,
        eventId: eventName,
        ownerUserId: user.sub,
        takenAt: takenAt ?? uploadedAt,
        uploadedAt,
        s3Bucket: process.env.S3_BUCKET_NAME,
        s3Key,
        mimeType: filetype,
      },
    })
  );

  await ddb.send(
    new PutCommand({
      TableName: process.env.DYNAMO_TABLE_NAME!,
      Item: {
        PK: "EVENT",
        SK: `EVENT#${eventName}`,
        eventId: eventName,
        updatedAt: uploadedAt,
      },
    })
  );

  return NextResponse.json({ signedUrl, s3Key });
}
