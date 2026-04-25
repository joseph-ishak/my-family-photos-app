/**
 * POST /api/photos/request-edit
 *
 * Phase 1 of the two-phase photo edit flow: verifies the caller owns the photo
 * and returns a pre-signed S3 PutObject URL so the client can upload the edited
 * version directly to S3.
 *
 * The client then calls `POST /api/photos/commit-edit` with the same `pk`,
 * `sk`, `s3Key`, and `filetype` to persist the updated metadata in DynamoDB.
 *
 * Ownership is verified here via a GetItem check. The commit step additionally
 * enforces ownership with a `ConditionExpression` to close the TOCTOU window.
 */
// src/app/api/photos/request-edit/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getVerifiedUser } from "@/lib/auth-server";
import { ddb, s3 } from "@/lib/db/client";
import { requireTable, requireBucket, withErrorHandler } from "@/lib/api";

export const POST = withErrorHandler("POST /api/photos/request-edit", async (req: NextRequest) => {
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

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: s3Key,
    ContentType: filetype,
  });

  const signedUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

  return NextResponse.json({ signedUrl });
});
