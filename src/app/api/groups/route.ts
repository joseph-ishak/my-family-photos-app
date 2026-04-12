// src/app/api/groups/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { getVerifiedUser } from "@/lib/auth-server";
import { ddb } from "@/lib/db/client";
import { asNonEmptyString, GroupRole } from "@/lib/utils";
import { requireTable, handleRouteError } from "@/lib/api";

export async function GET(req: NextRequest) {
  const user = await getVerifiedUser(req);
  if (!user?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const table = requireTable();

    const result = await ddb.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
        ExpressionAttributeValues: {
          ":pk": `USER#${user.sub}`,
          ":skPrefix": "GROUP#",
        },
        ProjectionExpression: "groupId, #name, #role, createdAt, SK",
        ExpressionAttributeNames: {
          "#name": "name",
          "#role": "role",
        },
      })
    );

    const items = (result.Items ?? []) as any[];

    const groups = items
      .map((it) => {
        const groupId =
          asNonEmptyString(it?.groupId) ??
          (typeof it?.SK === "string" ? it.SK.replace(/^GROUP#/, "") : null);

        if (!groupId) return null;

        const name = asNonEmptyString(it?.name) ?? groupId;

        const roleRaw = asNonEmptyString(it?.role) ?? "member";
        const role: GroupRole =
          roleRaw === "owner" || roleRaw === "admin" || roleRaw === "member"
            ? roleRaw
            : "member";

        const createdAt =
          typeof it?.createdAt === "string" ? it.createdAt : null;

        return { groupId, name, role, createdAt };
      })
      .filter(Boolean);

    groups.sort((a: any, b: any) =>
      String(a.name).localeCompare(String(b.name))
    );

    return NextResponse.json({ groups });
  } catch (err) {
    return handleRouteError("GET /api/groups", err);
  }
}

export async function POST(req: NextRequest) {
  const user = await getVerifiedUser(req);
  if (!user?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const table = requireTable();

    const body = await req.json().catch(() => ({} as any));
    const name = asNonEmptyString(body?.name);

    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const groupId = uuidv4();
    const now = new Date().toISOString();

    const groupPk = "GROUP";
    const groupSk = `GROUP#${groupId}`;

    const memberPk = `GROUP#${groupId}`;
    const memberSk = `MEMBER#${user.sub}`;

    const userPk = `USER#${user.sub}`;
    const userSk = `GROUP#${groupId}`;

    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: table,
              Item: {
                PK: groupPk,
                SK: groupSk,
                groupId,
                name,
                ownerUserId: user.sub,
                createdAt: now,
                updatedAt: now,
              },
              ConditionExpression:
                "attribute_not_exists(PK) AND attribute_not_exists(SK)",
            },
          },
          {
            Put: {
              TableName: table,
              Item: {
                PK: memberPk,
                SK: memberSk,
                groupId,
                userId: user.sub,
                role: "owner",
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
                PK: userPk,
                SK: userSk,
                groupId,
                name,
                role: "owner",
                createdAt: now,
              },
              ConditionExpression:
                "attribute_not_exists(PK) AND attribute_not_exists(SK)",
            },
          },
        ],
      })
    );

    return NextResponse.json(
      {
        groupId,
        name,
        role: "owner",
        createdAt: now,
      },
      { status: 201 }
    );
  } catch (err) {
    return handleRouteError("POST /api/groups", err);
  }
}
