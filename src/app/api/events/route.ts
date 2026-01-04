// src/app/api/events/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { getVerifiedUser } from "@/lib/auth-server";

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: "us-west-2" })
);

type EventSummary = {
  eventId: string;
  name: string;
  createdAt: string | null;
  updatedAt: string | null;
  photoCount: number;
  coverKey: string | null;
};

function normalizeEventId(raw: unknown): string | null {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v) return null;
  if (v.toLowerCase() === "default") return null;
  return v;
}

function asNonEmptyString(v: unknown) {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : null;
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function getUserGroupIds(
  table: string,
  userSub: string
): Promise<string[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
      ExpressionAttributeValues: {
        ":pk": `USER#${userSub}`,
        ":skPrefix": "GROUP#",
      },
      ProjectionExpression: "groupId, SK",
    })
  );

  const items = (res.Items ?? []) as any[];

  const groupIds = items
    .map((it) => {
      const gid = asNonEmptyString(it?.groupId);
      if (gid) return gid;
      const sk = asNonEmptyString(it?.SK);
      if (!sk) return null;
      return sk.replace(/^GROUP#/, "");
    })
    .filter(Boolean) as string[];

  return Array.from(new Set(groupIds));
}

async function getSharedEventIdsForUserGroups(
  table: string,
  eventIds: string[],
  groupIds: string[]
): Promise<Set<string>> {
  const out = new Set<string>();
  if (eventIds.length === 0) return out;
  if (groupIds.length === 0) return out;

  const keys: { PK: string; SK: string }[] = [];
  for (const eventId of eventIds) {
    for (const groupId of groupIds) {
      keys.push({
        PK: `EVENT#${eventId}`,
        SK: `SHARE#GROUP#${groupId}`,
      });
    }
  }

  const chunks = chunk(keys, 100);

  for (const c of chunks) {
    const got = await ddb.send(
      new BatchGetCommand({
        RequestItems: {
          [table]: {
            Keys: c,
            ProjectionExpression: "eventId, PK",
          },
        },
      })
    );

    const found = got.Responses?.[table] ?? [];
    for (const it of found as any[]) {
      const eid = asNonEmptyString(it?.eventId);
      if (eid) {
        out.add(eid);
        continue;
      }
      const pk = asNonEmptyString(it?.PK);
      if (pk && pk.startsWith("EVENT#")) out.add(pk.replace(/^EVENT#/, ""));
    }
  }

  return out;
}

export async function GET(req: NextRequest) {
  const user = await getVerifiedUser(req);
  if (!user?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const table = process.env.DYNAMO_TABLE_NAME!;
  if (!table) {
    return NextResponse.json(
      { error: "Server config missing" },
      { status: 500 }
    );
  }

  try {
    const groups = await getUserGroupIds(table, user.sub);

    const result = await ddb.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
        ExpressionAttributeValues: {
          ":pk": "EVENT",
          ":skPrefix": "EVENT#",
        },
        ProjectionExpression:
          "eventId, #name, createdAt, updatedAt, photoCount, coverKey, ownerUserId, SK",
        ExpressionAttributeNames: {
          "#name": "name",
        },
      })
    );

    const items = (result.Items ?? []) as any[];

    const allSummaries: (EventSummary & { ownerUserId?: string | null })[] =
      items
        .map((item) => {
          const eventId =
            normalizeEventId(item?.eventId) ??
            normalizeEventId(
              typeof item?.SK === "string" ? item.SK.replace(/^EVENT#/, "") : ""
            );

          if (!eventId) return null;

          const nameRaw =
            typeof item?.name === "string" && item.name.trim()
              ? item.name.trim()
              : eventId;

          const createdAt =
            typeof item?.createdAt === "string" ? item.createdAt : null;

          const updatedAt =
            typeof item?.updatedAt === "string" ? item.updatedAt : null;

          const photoCount =
            typeof item?.photoCount === "number" ? item.photoCount : 0;

          const coverKey =
            typeof item?.coverKey === "string" && item.coverKey.trim()
              ? item.coverKey.trim()
              : null;

          const ownerUserId =
            typeof item?.ownerUserId === "string" && item.ownerUserId.trim()
              ? item.ownerUserId.trim()
              : null;

          return {
            eventId,
            name: nameRaw,
            createdAt,
            updatedAt,
            photoCount,
            coverKey,
            ownerUserId,
          };
        })
        .filter(Boolean) as (EventSummary & { ownerUserId?: string | null })[];

    const mine = allSummaries.filter((e) => e.ownerUserId === user.sub);
    const notMine = allSummaries.filter((e) => e.ownerUserId !== user.sub);

    const sharedSet = await getSharedEventIdsForUserGroups(
      table,
      notMine.map((e) => e.eventId),
      groups
    );

    const visible = [
      ...mine,
      ...notMine.filter((e) => sharedSet.has(e.eventId)),
    ].map(({ ownerUserId, ...rest }) => rest);

    visible.sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      events: visible.map((e) => e.eventId),
      summaries: visible,
    });
  } catch (err) {
    console.error("Error fetching events:", err);
    return NextResponse.json({ events: [], summaries: [] }, { status: 500 });
  }
}
