import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  BatchGetCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { getVerifiedUser } from "@/lib/auth-server";
import { ddb, s3 } from "@/lib/db/client";
import { chunk } from "@/lib/utils";
import { requireTable, requireBucket, withErrorHandler } from "@/lib/api";

type DeleteItem = {
  pk: string;
  sk: string;
  key?: string;
};

const MAX_ITEMS = 200;

export const POST = withErrorHandler("POST /api/photos/bulk-delete", async (req: NextRequest) => {
  const user = await getVerifiedUser(req);
  if (!user?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const items = (body?.items ?? []) as DeleteItem[];

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "No items provided" }, { status: 400 });
  }

  if (items.length > MAX_ITEMS) {
    return NextResponse.json(
      { error: `Too many items. Max ${MAX_ITEMS}` },
      { status: 400 }
    );
  }

  const table = requireTable();
  const bucket = requireBucket();

  const keys = items.map((i) => ({ PK: i.pk, SK: i.sk }));

  const got = await ddb.send(
    new BatchGetCommand({
      RequestItems: {
        [table]: {
          Keys: keys,
          ProjectionExpression: "PK, SK, ownerUserId, s3Key",
        },
      },
    })
  );

  const found = got.Responses?.[table] ?? [];

  const deletable = found.filter((x: any) => x.ownerUserId === user.sub);

  if (deletable.length === 0) {
    return NextResponse.json(
      { error: "Nothing deletable for this user" },
      { status: 403 }
    );
  }

  const txChunks = chunk(deletable, 25);
  for (const c of txChunks) {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: c.map((d: any) => ({
          Delete: {
            TableName: table,
            Key: { PK: d.PK, SK: d.SK },
            ConditionExpression: "ownerUserId = :u",
            ExpressionAttributeValues: { ":u": user.sub },
          },
        })),
      })
    );
  }

  const s3Keys = deletable
    .map((d: any) => d.s3Key)
    .filter(Boolean)
    .map((k: string) => ({ Key: k }));

  if (s3Keys.length > 0) {
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: s3Keys, Quiet: true },
      })
    );
  }

  return NextResponse.json({
    success: true,
    deletedCount: deletable.length,
  });
});
