// src/app/api/events/[eventId]/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { getVerifiedUser } from "@/lib/auth-server";
import { ddb } from "@/lib/db/client";
import { asNonEmptyString } from "@/lib/utils";
import { requireTable, withErrorHandler } from "@/lib/api";

async function requireEventOwner(
  table: string,
  eventId: string,
  userSub: string
) {
  const evRes = await ddb.send(
    new GetCommand({
      TableName: table,
      Key: { PK: "EVENT", SK: `EVENT#${eventId}` },
      ProjectionExpression: "eventId, ownerUserId",
    })
  );

  const ev = evRes.Item as any;
  if (!ev) {
    return { ok: false as const, status: 404 as const, error: "Event not found" };
  }

  const ownerUserId = asNonEmptyString(ev?.ownerUserId);
  if (!ownerUserId || ownerUserId !== userSub) {
    return { ok: false as const, status: 403 as const, error: "Only the event owner can change the cover photo" };
  }

  return { ok: true as const, event: ev };
}

export const PATCH = withErrorHandler("PATCH /api/events/[eventId]", async (req: NextRequest, ctx: any) => {
  const user = await getVerifiedUser(req);
  if (!user?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = await Promise.resolve(ctx?.params);
  const eventId = decodeURIComponent(String(params?.eventId || "")).trim();
  if (!eventId) {
    return NextResponse.json({ error: "Missing eventId" }, { status: 400 });
  }

  const table = requireTable();

  const body = await req.json().catch(() => ({} as any));
  const coverKey = asNonEmptyString(body?.coverKey);
  if (!coverKey) {
    return NextResponse.json({ error: "coverKey is required" }, { status: 400 });
  }

  const ownerCheck = await requireEventOwner(table, eventId, user.sub);
  if (!ownerCheck.ok) {
    return NextResponse.json({ error: ownerCheck.error }, { status: ownerCheck.status });
  }

  await ddb.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: "EVENT", SK: `EVENT#${eventId}` },
      UpdateExpression: "SET coverKey = :coverKey, updatedAt = :now",
      ConditionExpression: "ownerUserId = :sub",
      ExpressionAttributeValues: {
        ":coverKey": coverKey,
        ":now": new Date().toISOString(),
        ":sub": user.sub,
      },
    })
  );

  return NextResponse.json({ eventId, coverKey });
});
