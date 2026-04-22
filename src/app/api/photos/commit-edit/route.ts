// src/app/api/photos/commit-edit/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getVerifiedUser } from "@/lib/auth-server";
import { ddb, s3 } from "@/lib/db/client";
import { requireTable, requireBucket, withErrorHandler } from "@/lib/api";

export const POST = withErrorHandler("POST /api/photos/commit-edit", async (req: NextRequest) => {
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

  const table = requireTable();
  const bucket = requireBucket();

  const got = await ddb.send(
    new GetCommand({
      TableName: table,
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

  // ConditionExpression closes the TOCTOU window: even if ownership changed
  // between the GetCommand above and this write, the update will fail safely.
  await ddb.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: pk, SK: sk },
      UpdateExpression: "SET editedAt = :t, mimeType = :m",
      ConditionExpression: "ownerUserId = :owner AND s3Key = :key",
      ExpressionAttributeValues: {
        ":t": editedAt,
        ":m": filetype,
        ":owner": user.sub,
        ":key": s3Key,
      },
    })
  );

  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucket,
      Key: s3Key,
    }),
    { expiresIn: 3600 }
  );

  return NextResponse.json({ ok: true, editedAt, url });
});
