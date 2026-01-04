// src/app/api/users/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
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

function toUserLite(item: any) {
  const pk = safeStr(item?.PK);
  const userId = pk.startsWith("USER#") ? pk.slice("USER#".length) : pk;

  return {
    userId,
    firstName: safeStr(item?.firstName),
    lastName: safeStr(item?.lastName),
    nickname: safeStr(item?.nickname),
    username: safeStr(item?.username),
    avatarKey: item?.avatarKey ?? null,
  };
}

function matchesQuery(u: any, q: string) {
  if (!q) return true;
  const hay = [u.firstName, u.lastName, u.nickname, u.username, u.userId]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return hay.includes(q);
}

export async function GET(req: NextRequest) {
  const me = await getVerifiedUser(req);
  if (!me?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const query = (url.searchParams.get("query") || "").trim().toLowerCase();
  const limitRaw = Number(url.searchParams.get("limit") || "20");
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(50, limitRaw))
    : 20;

  const out: any[] = [];
  let lastKey: any = undefined;

  // For family sized user counts, Scan is fine.
  // We scan PROFILE items and filter in memory.
  while (out.length < limit) {
    const r = await ddb.send(
      new ScanCommand({
        TableName: process.env.DYNAMO_TABLE_NAME!,
        ExclusiveStartKey: lastKey,
        FilterExpression: "entityType = :t AND SK = :sk",
        ExpressionAttributeValues: {
          ":t": "PROFILE",
          ":sk": "PROFILE",
        },
        ProjectionExpression:
          "PK, SK, firstName, lastName, nickname, username, avatarKey, entityType",
        Limit: 200,
      })
    );

    const items = Array.isArray(r.Items) ? r.Items : [];
    for (const item of items) {
      const u = toUserLite(item);
      if (!matchesQuery(u, query)) continue;
      out.push(u);
      if (out.length >= limit) break;
    }

    lastKey = r.LastEvaluatedKey;
    if (!lastKey) break;
  }

  // Sign avatar URLs only for returned items.
  const users = await Promise.all(
    out.map(async (u) => {
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

  // Simple sorting for nicer UI
  users.sort((a, b) => {
    const al = (a.lastName || "").toLowerCase();
    const bl = (b.lastName || "").toLowerCase();
    if (al !== bl) return al.localeCompare(bl);
    const af = (a.firstName || "").toLowerCase();
    const bf = (b.firstName || "").toLowerCase();
    if (af !== bf) return af.localeCompare(bf);
    return (a.username || "").localeCompare(b.username || "");
  });

  return NextResponse.json({ users });
}
