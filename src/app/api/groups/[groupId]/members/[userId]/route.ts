// src/app/api/groups/[groupId]/members/[userId]/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { getVerifiedUser } from "@/lib/auth-server";

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: "us-west-2" })
);

type GroupRole = "owner" | "admin" | "member";

function asNonEmptyString(v: unknown) {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : null;
}

function normalizeRole(v: unknown): GroupRole {
  const s = asNonEmptyString(v);
  if (s === "owner" || s === "admin" || s === "member") return s;
  return "member";
}

export async function DELETE(req: NextRequest, ctx: any) {
  const user = await getVerifiedUser(req);
  if (!user?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = await Promise.resolve(ctx?.params);

  const groupId = decodeURIComponent(String(params?.groupId || "")).trim();
  const targetUserId = decodeURIComponent(String(params?.userId || "")).trim();

  if (!groupId) {
    return NextResponse.json({ error: "Missing groupId" }, { status: 400 });
  }
  if (!targetUserId) {
    return NextResponse.json({ error: "Missing userId" }, { status: 400 });
  }

  const table = process.env.DYNAMO_TABLE_NAME!;
  if (!table) {
    return NextResponse.json(
      { error: "Server config missing" },
      { status: 500 }
    );
  }

  try {
    const groupRes = await ddb.send(
      new GetCommand({
        TableName: table,
        Key: { PK: "GROUP", SK: `GROUP#${groupId}` },
        ProjectionExpression: "ownerUserId",
      })
    );

    const ownerUserId = asNonEmptyString((groupRes.Item as any)?.ownerUserId);
    if (!ownerUserId) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    if (targetUserId === ownerUserId) {
      return NextResponse.json(
        { error: "Cannot remove the owner" },
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

    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Delete: {
              TableName: table,
              Key: { PK: `GROUP#${groupId}`, SK: `MEMBER#${targetUserId}` },
            },
          },
          {
            Delete: {
              TableName: table,
              Key: { PK: `USER#${targetUserId}`, SK: `GROUP#${groupId}` },
            },
          },
        ],
      })
    );

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("DELETE /api/groups/[groupId]/members/[userId] error", err);
    return NextResponse.json(
      { error: err?.message || "Remove failed" },
      { status: 500 }
    );
  }
}
