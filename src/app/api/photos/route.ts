import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  DeleteCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: "us-west-2" })
);
const s3 = new S3Client({ region: "us-west-2" });

export async function GET() {
  console.log("GET /api/photos called");
  try {
    // Scan for all items where SK begins with "PHOTO#"
    const result = await ddb.send(
      new ScanCommand({
        TableName: process.env.DYNAMO_TABLE_NAME!,
        FilterExpression: "begins_with(SK, :photoPrefix)",
        ExpressionAttributeValues: {
          ":photoPrefix": "PHOTO#",
        },
        ProjectionExpression: "s3Key, eventId, takenAt, ownerUserId, SK",
      })
    );

    // For each photo, get a signed S3 URL and include eventId and takenAt
    const photos = await Promise.all(
      (result.Items || []).map(async (item) => {
        const url = await getSignedUrl(
          s3,
          new GetObjectCommand({
            Bucket: process.env.S3_BUCKET_NAME!,
            Key: item.s3Key,
          }),
          { expiresIn: 3600 }
        );
        console.log("Item fetched:", item);
        return {
          key: item.s3Key,
          url,
          eventId: item.eventId, // <-- include eventId
          takenAt: item.takenAt,
          ownerId: item.ownerUserId, // <-- include takenAt
        };
      })
    );
    console.log("Fetched photos with signed URLs:", photos.length);
    return NextResponse.json({ photos });
  } catch (err) {
    console.error("Error fetching photos:", err);
    return NextResponse.json({ photos: [] }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  console.log("DELETE /api/photos called");
  const { searchParams } = new URL(req.url);
  const key = searchParams.get("key");
  if (!key) return NextResponse.json({ error: "Missing key" }, { status: 400 });

  // Scan for the item with this s3Key
  const result = await ddb.send(
    new ScanCommand({
      TableName: process.env.DYNAMO_TABLE_NAME!,
      FilterExpression: "s3Key = :key",
      ExpressionAttributeValues: { ":key": key },
      ProjectionExpression: "PK, SK",
    })
  );
  const item = result.Items?.[0];
  if (!item)
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });

  // Delete from DynamoDB
  await ddb.send(
    new DeleteCommand({
      TableName: process.env.DYNAMO_TABLE_NAME!,
      Key: { PK: item.PK, SK: item.SK },
    })
  );

  // Delete from S3
  await s3.send(
    new DeleteObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME!,
      Key: key,
    })
  );

  return NextResponse.json({ success: true });
}
