/**
 * POST /api/users/resolve
 *
 * Batch-fetches user profiles by a list of user IDs (Cognito `sub` values).
 * Used to enrich data with display names and avatars without hitting
 * `GET /api/users` once per user.
 *
 * Request body: { userIds: string[] }
 * Response:     { users: UserLite[] }  (same shape as GET /api/users)
 *
 * IDs are looked up via BatchGet in chunks of 100 to stay within DynamoDB's
 * per-request limit. Avatar URLs are pre-signed before returning.
 */
// src/app/api/users/resolve/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { BatchGetCommand } from "@aws-sdk/lib-dynamodb";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getVerifiedUser } from "@/lib/auth-server";
import { ddb, s3 } from "@/lib/db/client";
import { chunk } from "@/lib/utils";
import { withErrorHandler } from "@/lib/api";

/** Coerces an unknown value to a string, returning `""` for non-string types. */
function safeStr(v: any) {
  return typeof v === "string" ? v : "";
}

export const POST = withErrorHandler("POST /api/users/resolve", async (req: NextRequest) => {
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
});
