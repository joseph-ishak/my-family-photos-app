import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  BatchGetCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { S3Client, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { getVerifiedUser } from "@/lib/auth-server";

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: "us-west-2" })
);
const s3 = new S3Client({ region: "us-west-2" });

type DeleteItem = {
  pk: string;
  sk: string;
  key?: string;
};

const MAX_ITEMS = 200;

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function POST(req: NextRequest) {
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

  const keys = items.map((i) => ({ PK: i.pk, SK: i.sk }));

  const got = await ddb.send(
    new BatchGetCommand({
      RequestItems: {
        [process.env.DYNAMO_TABLE_NAME!]: {
          Keys: keys,
          ProjectionExpression: "PK, SK, ownerUserId, s3Key",
        },
      },
    })
  );

  const found = got.Responses?.[process.env.DYNAMO_TABLE_NAME!] ?? [];

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
            TableName: process.env.DYNAMO_TABLE_NAME!,
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
        Bucket: process.env.S3_BUCKET_NAME!,
        Delete: { Objects: s3Keys, Quiet: true },
      })
    );
  }

  return NextResponse.json({
    success: true,
    deletedCount: deletable.length,
  });
}
