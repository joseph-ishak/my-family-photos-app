// src/app/api/photos/request-edit/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
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

  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME!,
    Key: s3Key,
    ContentType: filetype,
  });

  const signedUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

  return NextResponse.json({ signedUrl });
}
