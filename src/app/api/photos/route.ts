import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getVerifiedUser } from "@/lib/auth-server";

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: "us-west-2" })
);
const s3 = new S3Client({ region: "us-west-2" });

export async function GET(req: NextRequest) {
  const user = await getVerifiedUser(req);
  if (!user?.sub)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? "20"), 50);
  const cursor = searchParams.get("cursor");

  const ExclusiveStartKey = cursor
    ? JSON.parse(Buffer.from(cursor, "base64").toString("utf8"))
    : undefined;

  try {
    const result = await ddb.send(
      new QueryCommand({
        TableName: process.env.DYNAMO_TABLE_NAME!,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: { ":pk": "PHOTO" },
        Limit: limit,
        ScanIndexForward: false,
        ExclusiveStartKey,
        ProjectionExpression: "PK, SK, s3Key, eventId, takenAt, ownerUserId",
      })
    );

    const photos = await Promise.all(
      (result.Items || []).map(async (item: any) => {
        const url = await getSignedUrl(
          s3,
          new GetObjectCommand({
            Bucket: process.env.S3_BUCKET_NAME!,
            Key: item.s3Key,
          }),
          { expiresIn: 3600 }
        );

        return {
          key: item.s3Key,
          url,
          eventId: item.eventId,
          takenAt: item.takenAt,
          ownerUserId: item.ownerUserId,
          pk: item.PK,
          sk: item.SK,
        };
      })
    );

    const nextCursor = result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey), "utf8").toString(
          "base64"
        )
      : null;

    return NextResponse.json({ photos, nextCursor });
  } catch (err) {
    console.error("Error fetching photos:", err);
    return NextResponse.json({ photos: [] }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const user = await getVerifiedUser(req);
  if (!user?.sub)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const key = searchParams.get("key");
  const pk = searchParams.get("pk");
  const sk = searchParams.get("sk");

  if (!key || !pk || !sk) {
    return NextResponse.json({ error: "Missing key pk sk" }, { status: 400 });
  }

  const itemRes = await ddb.send(
    new GetCommand({
      TableName: process.env.DYNAMO_TABLE_NAME!,
      Key: { PK: pk, SK: sk },
      ProjectionExpression: "ownerUserId, s3Key",
    })
  );

  const item: any = itemRes.Item;
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (item.ownerUserId !== user.sub) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await ddb.send(
    new DeleteCommand({
      TableName: process.env.DYNAMO_TABLE_NAME!,
      Key: { PK: pk, SK: sk },
      ConditionExpression: "ownerUserId = :u",
      ExpressionAttributeValues: { ":u": user.sub },
    })
  );

  await s3.send(
    new DeleteObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME!,
      Key: item.s3Key || key,
    })
  );

  return NextResponse.json({ success: true });
}
