// src/app/api/users/resolve/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, BatchGetCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getVerifiedUser } from "@/lib/auth-server";

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: "us-west-2" })
);

const s3 = new S3Client({ region: "us-west-2" });

function safeStr(v: any) {
  return typeof v === "string" ? v : "";
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function POST(req: NextRequest) {
  const me = await getVerifiedUser(req);
  if (!me?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const ids = Array.isArray(body?.userIds) ? body.userIds : [];
  const userIds = ids
    .map((x: any) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean);

  if (!userIds.length) {
    return NextResponse.json({ users: [] });
  }

  const table = process.env.DYNAMO_TABLE_NAME!;
  const results: any[] = [];

  for (const group of chunk(userIds, 100)) {
    const keys = group.map((userId) => ({
      PK: `USER#${userId}`,
      SK: "PROFILE",
    }));

    const r = await ddb.send(
      new BatchGetCommand({
        RequestItems: {
          [table]: {
            Keys: keys,
            ProjectionExpression:
              "PK, SK, firstName, lastName, nickname, username, avatarKey, entityType",
          },
        },
      })
    );

    const items = r.Responses?.[table] ?? [];
    for (const item of items) {
      const pk = safeStr(item?.PK);
      const userId = pk.startsWith("USER#") ? pk.slice("USER#".length) : pk;

      results.push({
        userId,
        firstName: safeStr(item?.firstName),
        lastName: safeStr(item?.lastName),
        nickname: safeStr(item?.nickname),
        username: safeStr(item?.username),
        avatarKey: item?.avatarKey ?? null,
      });
    }
  }

  const users = await Promise.all(
    results.map(async (u) => {
      let avatarUrl: string | null = null;
      if (u.avatarKey) {
        avatarUrl = await getSignedUrl(
          s3,
          new GetObjectCommand({
            Bucket: process.env.S3_BUCKET_NAME!,
            Key: u.avatarKey,
          }),
          { expiresIn: 3600 }
        );
      }
      return { ...u, avatarUrl };
    })
  );

  return NextResponse.json({ users });
}
