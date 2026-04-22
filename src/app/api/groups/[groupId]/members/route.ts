// src/app/api/groups/[groupId]/members/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  GetCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { getVerifiedUser } from "@/lib/auth-server";
import { ddb } from "@/lib/db/client";
import { asNonEmptyString, normalizeRole } from "@/lib/utils";
import { requireTable, withErrorHandler } from "@/lib/api";

export const POST = withErrorHandler("POST /api/groups/[groupId]/members", async (req: NextRequest, ctx: any) => {
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

  const body = await req.json().catch(() => ({} as any));
  const targetUserId = asNonEmptyString(body?.userId);
  const role = normalizeRole(body?.role);

  if (!targetUserId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  if (role === "owner") {
    return NextResponse.json(
      { error: "Cannot assign owner role" },
      { status: 400 }
    );
  }

  const myMemberRes = await ddb.send(
    new GetCommand({
      TableName: table,
      Key: { PK: `GROUP#${groupId}`, SK: `MEMBER#${user.sub}` },
      ProjectionExpression: "userId, #role",
      ExpressionAttributeNames: { "#role": "role" },
    })
  );

  const myRole = normalizeRole((myMemberRes.Item as any)?.role);
  if (!myMemberRes.Item || (myRole !== "owner" && myRole !== "admin")) {
    return NextResponse.json(
      { error: "Not allowed to manage members" },
      { status: 403 }
    );
  }

  const groupRes = await ddb.send(
    new GetCommand({
      TableName: table,
      Key: { PK: "GROUP", SK: `GROUP#${groupId}` },
      ProjectionExpression: "groupId, #name",
      ExpressionAttributeNames: { "#name": "name" },
    })
  );

  const groupItem = groupRes.Item as any;
  if (!groupItem) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  const now = new Date().toISOString();
  const groupName = asNonEmptyString(groupItem?.name) ?? groupId;

  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: table,
            Item: {
              PK: `GROUP#${groupId}`,
              SK: `MEMBER#${targetUserId}`,
              groupId,
              userId: targetUserId,
              role,
              createdAt: now,
            },
            ConditionExpression:
              "attribute_not_exists(PK) AND attribute_not_exists(SK)",
          },
        },
        {
          Put: {
            TableName: table,
            Item: {
              PK: `USER#${targetUserId}`,
              SK: `GROUP#${groupId}`,
              groupId,
              name: groupName,
              role,
              createdAt: now,
            },
            ConditionExpression:
              "attribute_not_exists(PK) AND attribute_not_exists(SK)",
          },
        },
      ],
    })
  );

  return NextResponse.json({ success: true }, { status: 201 });
});
