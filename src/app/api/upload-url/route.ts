import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { PutCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";

const s3 = new S3Client({ region: "us-west-2" });
const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: "us-west-2" })
);

export async function POST(req: Request) {
  const { filename, filetype, eventId, userId, takenAt } = await req.json();

  const photoId = uuidv4();
  const uploadedAt = new Date().toISOString();
  const s3Key = `uploads/${filename}`;

  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME!,
    Key: s3Key,
    ContentType: filetype,
  });

  const signedUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

  // Insert photo metadata into DynamoDB
  await ddb.send(
    new PutCommand({
      TableName: process.env.DYNAMO_TABLE_NAME!,
      Item: {
        PK: `EVENT#${eventId ?? "default"}`,
        SK: `PHOTO#${takenAt ?? uploadedAt}#${photoId}`,
        photoId,
        eventId: eventId ?? "default",
        ownerUserId: userId ?? "unknown",
        takenAt: takenAt ?? uploadedAt,
        uploadedAt,
        s3Bucket: process.env.S3_BUCKET_NAME,
        s3Key,
        mimeType: filetype,
      },
    })
  );

  return NextResponse.json({ signedUrl });
}
