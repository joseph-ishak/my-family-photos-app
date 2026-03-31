// src/app/api/events/[eventId]/share/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  GetCommand,
  QueryCommand,
  BatchGetCommand,
  TransactWriteCommand,
  type BatchGetCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { getVerifiedUser } from "@/lib/auth-server";
import { ddb } from "@/lib/db/client";
import { asNonEmptyString, normalizeRole, chunk } from "@/lib/utils";
import { requireTable } from "@/lib/api";

async function requireEventOwner(
  table: string,
  eventId: string,
  userSub: string
) {
  const evRes = await ddb.send(
    new GetCommand({
      TableName: table,
      Key: { PK: "EVENT", SK: `EVENT#${eventId}` },
      ProjectionExpression: "eventId, ownerUserId, #name",
      ExpressionAttributeNames: { "#name": "name" },
    })
  );

  const ev = evRes.Item as any;
  if (!ev) {
    return {
      ok: false as const,
      status: 404 as const,
      error: "Event not found",
    };
  }

  const ownerUserId = asNonEmptyString(ev?.ownerUserId);
  if (!ownerUserId || ownerUserId !== userSub) {
    return {
      ok: false as const,
      status: 403 as const,
      error: "Only the event owner can manage sharing",
    };
  }

  return { ok: true as const, event: ev };
}

export async function GET(req: NextRequest, ctx: any) {
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

  const ownerCheck = await requireEventOwner(table, eventId, user.sub);
  if (!ownerCheck.ok) {
    return NextResponse.json(
      { error: ownerCheck.error },
      { status: ownerCheck.status }
    );
  }

  try {
    const sharesRes = await ddb.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
        ExpressionAttributeValues: {
          ":pk": `EVENT#${eventId}`,
          ":skPrefix": "SHARE#GROUP#",
        },
        ProjectionExpression: "PK, SK, groupId, createdAt, createdBy",
      })
    );

    const items = (sharesRes.Items ?? []) as any[];

    const groupIds = Array.from(
      new Set(
        items
          .map((it) => asNonEmptyString(it?.groupId))
          .filter(Boolean) as string[]
      )
    );

    const groupNameMap = new Map<string, string>();

    if (groupIds.length > 0) {
      const keys = groupIds.map((gid) => ({ PK: "GROUP", SK: `GROUP#${gid}` }));
      const chunks = chunk(keys, 100);

      for (const c of chunks) {
        const input: BatchGetCommandInput = {
          RequestItems: {
            [table]: {
              Keys: c,
              ProjectionExpression: "groupId, #name, SK",
              ExpressionAttributeNames: { "#name": "name" },
            },
          },
        };

        const got = await ddb.send(new BatchGetCommand(input));
        const found = (got.Responses?.[table] ?? []) as any[];

        for (const g of found) {
          const gid =
            asNonEmptyString(g?.groupId) ??
            (typeof g?.SK === "string" ? g.SK.replace(/^GROUP#/, "") : null);

          const name = asNonEmptyString(g?.name);
          if (gid && name) groupNameMap.set(gid, name);
        }
      }
    }

    const shares = items
      .map((it) => {
        const gid =
          asNonEmptyString(it?.groupId) ??
          (typeof it?.SK === "string"
            ? it.SK.replace(/^SHARE#GROUP#/, "")
            : null);

        if (!gid) return null;

        return {
          groupId: gid,
          groupName: groupNameMap.get(gid) ?? undefined,
          createdAt: typeof it?.createdAt === "string" ? it.createdAt : null,
        };
      })
      .filter(Boolean) as {
      groupId: string;
      groupName?: string;
      createdAt: string | null;
    }[];

    shares.sort((a, b) => {
      const an = (a.groupName || a.groupId).toLowerCase();
      const bn = (b.groupName || b.groupId).toLowerCase();
      return an.localeCompare(bn);
    });

    return NextResponse.json({ shares });
  } catch (err: any) {
    console.error("GET /api/events/[eventId]/share error", err);
    return NextResponse.json(
      { error: err?.message || "Failed to load shares" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest, ctx: any) {
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
  const groupId = asNonEmptyString(body?.groupId);

  if (!groupId) {
    return NextResponse.json({ error: "groupId is required" }, { status: 400 });
  }

  try {
    const ownerCheck = await requireEventOwner(table, eventId, user.sub);
    if (!ownerCheck.ok) {
      return NextResponse.json(
        { error: ownerCheck.error },
        { status: ownerCheck.status }
      );
    }

    const memberRes = await ddb.send(
      new GetCommand({
        TableName: table,
        Key: { PK: `GROUP#${groupId}`, SK: `MEMBER#${user.sub}` },
        ProjectionExpression: "userId, #role, createdAt",
        ExpressionAttributeNames: { "#role": "role" },
      })
    );

    const membership = memberRes.Item as any;
    if (!membership) {
      return NextResponse.json(
        { error: "You are not a member of that group" },
        { status: 403 }
      );
    }

    const myRole = normalizeRole(membership?.role);
    if (myRole !== "owner" && myRole !== "admin") {
      return NextResponse.json(
        { error: "Only group owners or admins can share events to this group" },
        { status: 403 }
      );
    }

    const now = new Date().toISOString();

    const eventSharePk = `EVENT#${eventId}`;
    const eventShareSk = `SHARE#GROUP#${groupId}`;

    const groupSharePk = `GROUP#${groupId}`;
    const groupShareSk = `SHARE#EVENT#${eventId}`;

    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: table,
              Item: {
                PK: eventSharePk,
                SK: eventShareSk,
                eventId,
                groupId,
                createdAt: now,
                createdBy: user.sub,
              },
              ConditionExpression:
                "attribute_not_exists(PK) AND attribute_not_exists(SK)",
            },
          },
          {
            Put: {
              TableName: table,
              Item: {
                PK: groupSharePk,
                SK: groupShareSk,
                eventId,
                groupId,
                createdAt: now,
                createdBy: user.sub,
              },
              ConditionExpression:
                "attribute_not_exists(PK) AND attribute_not_exists(SK)",
            },
          },
        ],
      })
    );

    return NextResponse.json(
      { success: true, eventId, groupId, createdAt: now },
      { status: 201 }
    );
  } catch (err: any) {
    const msg = String(err?.message || "");
    if (msg.includes("ConditionalCheckFailedException")) {
      return NextResponse.json(
        { error: "Already shared to that group" },
        { status: 409 }
      );
    }

    console.error("POST /api/events/[eventId]/share error", err);
    return NextResponse.json(
      { error: err?.message || "Share failed" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest, ctx: any) {
  const user = await getVerifiedUser(req);
  if (!user?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = await Promise.resolve(ctx?.params);
  const eventId = decodeURIComponent(String(params?.eventId || "")).trim();
  if (!eventId) {
    return NextResponse.json({ error: "Missing eventId" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const groupId = asNonEmptyString(searchParams.get("groupId"));

  if (!groupId) {
    return NextResponse.json({ error: "groupId is required" }, { status: 400 });
  }

  const table = requireTable();

  try {
    const ownerCheck = await requireEventOwner(table, eventId, user.sub);
    if (!ownerCheck.ok) {
      return NextResponse.json(
        { error: ownerCheck.error },
        { status: ownerCheck.status }
      );
    }

    const eventSharePk = `EVENT#${eventId}`;
    const eventShareSk = `SHARE#GROUP#${groupId}`;

    const groupSharePk = `GROUP#${groupId}`;
    const groupShareSk = `SHARE#EVENT#${eventId}`;

    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Delete: {
              TableName: table,
              Key: { PK: eventSharePk, SK: eventShareSk },
            },
          },
          {
            Delete: {
              TableName: table,
              Key: { PK: groupSharePk, SK: groupShareSk },
            },
          },
        ],
      })
    );

    return NextResponse.json({ success: true, eventId, groupId });
  } catch (err: any) {
    console.error("DELETE /api/events/[eventId]/share error", err);
    return NextResponse.json(
      { error: err?.message || "Unshare failed" },
      { status: 500 }
    );
  }
}
