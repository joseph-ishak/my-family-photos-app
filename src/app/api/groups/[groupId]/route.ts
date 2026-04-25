/**
 * Single-group endpoints.
 *
 * GET — fetch group metadata and member list (members only).
 * PUT — rename the group; also updates the denormalized name in every member's
 *       `USER#<sub> / GROUP#<id>` index record (owner only).
 */
// src/app/api/groups/[groupId]/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { getVerifiedUser } from "@/lib/auth-server";
import { ddb } from "@/lib/db/client";
import { asNonEmptyString, normalizeRole } from "@/lib/utils";
import { requireTable, withErrorHandler } from "@/lib/api";

/**
 * Returns the membership record for `userId` in `groupId`, or `undefined` if
 * the user is not a member. Used to verify access before returning group details
 * or performing mutations.
 */
async function getMyMembership(table: string, groupId: string, userId: string) {
  const res = await ddb.send(
    new GetCommand({
      TableName: table,
      Key: { PK: `GROUP#${groupId}`, SK: `MEMBER#${userId}` },
      ProjectionExpression: "userId, #role, createdAt",
      ExpressionAttributeNames: { "#role": "role" },
    })
  );
  return res.Item as any;
}

export const GET = withErrorHandler("GET /api/groups/[groupId]", async (req: NextRequest, ctx: any) => {
  const user = await getVerifiedUser(req);
  if (!user?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = await Promise.resolve(ctx?.params);
  const groupId = decodeURIComponent(String(params?.groupId || "")).trim();
  if (!groupId) {
    return NextResponse.json({ error: "Missing groupId" }, { status: 400 });
  }

  const table = requireTable();

  const membership = await getMyMembership(table, groupId, user.sub);
  if (!membership) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  const groupRes = await ddb.send(
    new GetCommand({
      TableName: table,
      Key: { PK: "GROUP", SK: `GROUP#${groupId}` },
      ProjectionExpression:
        "groupId, #name, ownerUserId, createdAt, updatedAt, SK",
      ExpressionAttributeNames: { "#name": "name" },
    })
  );

  const groupItem = groupRes.Item as any;
  if (!groupItem) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  const membersRes = await ddb.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: {
        ":pk": `GROUP#${groupId}`,
        ":prefix": "MEMBER#",
      },
      ProjectionExpression: "userId, #role, createdAt, SK",
      ExpressionAttributeNames: { "#role": "role" },
    })
  );

  const membersRaw = (membersRes.Items ?? []) as any[];

  const members = membersRaw
    .map((m) => {
      const userId =
        asNonEmptyString(m?.userId) ??
        (typeof m?.SK === "string" ? m.SK.replace(/^MEMBER#/, "") : null);

      if (!userId) return null;

      return {
        userId,
        role: normalizeRole(m?.role),
        createdAt: typeof m?.createdAt === "string" ? m.createdAt : null,
      };
    })
    .filter(Boolean);

  const group = {
    groupId,
    name: asNonEmptyString(groupItem?.name) ?? groupId,
    role: normalizeRole(membership?.role),
    createdAt:
      typeof groupItem?.createdAt === "string" ? groupItem.createdAt : null,
    updatedAt:
      typeof groupItem?.updatedAt === "string" ? groupItem.updatedAt : null,
    ownerUserId: asNonEmptyString(groupItem?.ownerUserId),
  };

  return NextResponse.json({ group, members });
});

export const PUT = withErrorHandler("PUT /api/groups/[groupId]", async (req: NextRequest, ctx: any) => {
  const user = await getVerifiedUser(req);
  if (!user?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = await Promise.resolve(ctx?.params);
  const groupId = decodeURIComponent(String(params?.groupId || "")).trim();
  if (!groupId) {
    return NextResponse.json({ error: "Missing groupId" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({} as any));
  const name = asNonEmptyString(body?.name);

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const table = requireTable();

  const membership = await getMyMembership(table, groupId, user.sub);
  const myRole = normalizeRole(membership?.role);
  if (!membership || myRole !== "owner") {
    return NextResponse.json(
      { error: "Only the owner can rename the group" },
      { status: 403 }
    );
  }

  const now = new Date().toISOString();

  await ddb.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: "GROUP", SK: `GROUP#${groupId}` },
      UpdateExpression: "SET #name = :n, updatedAt = :now",
      ExpressionAttributeNames: { "#name": "name" },
      ExpressionAttributeValues: {
        ":n": name,
        ":now": now,
      },
    })
  );

  const membersRes = await ddb.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: {
        ":pk": `GROUP#${groupId}`,
        ":prefix": "MEMBER#",
      },
      ProjectionExpression: "userId, SK",
    })
  );

  const membersRaw = (membersRes.Items ?? []) as any[];

  for (const m of membersRaw) {
    const userId =
      asNonEmptyString(m?.userId) ??
      (typeof m?.SK === "string" ? m.SK.replace(/^MEMBER#/, "") : null);

    if (!userId) continue;

    await ddb.send(
      new UpdateCommand({
        TableName: table,
        Key: { PK: `USER#${userId}`, SK: `GROUP#${groupId}` },
        UpdateExpression: "SET #name = :n",
        ExpressionAttributeNames: { "#name": "name" },
        ExpressionAttributeValues: { ":n": name },
      })
    );
  }

  return NextResponse.json({ success: true, groupId, name, updatedAt: now });
});
