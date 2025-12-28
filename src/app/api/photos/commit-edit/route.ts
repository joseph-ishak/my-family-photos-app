// src/app/api/photos/commit-edit/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getVerifiedUser } from "@/lib/auth-server";

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: "us-west-2" })
);
const s3 = new S3Client({ region: "us-west-2" });

export async function POST(req: NextRequest) {
  const user = await getVerifiedUser(req);
  if (!user?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { pk, sk, s3Key, filetype } = await req.json();

  if (!pk || !sk || !s3Key || !filetype) {
    return NextResponse.json(
      { error: "Missing pk, sk, s3Key, or filetype" },
      { status: 400 }
    );
  }

  const got = await ddb.send(
    new GetCommand({
      TableName: process.env.DYNAMO_TABLE_NAME!,
      Key: { PK: pk, SK: sk },
      ProjectionExpression: "ownerUserId, s3Key",
    })
  );

  const item = got.Item as any;
  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (item.ownerUserId !== user.sub) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (item.s3Key !== s3Key) {
    return NextResponse.json({ error: "Key mismatch" }, { status: 400 });
  }

  const editedAt = new Date().toISOString();

  await ddb.send(
    new UpdateCommand({
      TableName: process.env.DYNAMO_TABLE_NAME!,
      Key: { PK: pk, SK: sk },
      UpdateExpression: "SET editedAt = :t, mimeType = :m",
      ExpressionAttributeValues: {
        ":t": editedAt,
        ":m": filetype,
      },
    })
  );

  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME!,
      Key: s3Key,
    }),
    { expiresIn: 3600 }
  );

  return NextResponse.json({ ok: true, editedAt, url });
}
