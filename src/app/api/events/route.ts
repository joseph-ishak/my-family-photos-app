// src/app/api/events/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  BatchGetCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { getVerifiedUser } from "@/lib/auth-server";
import { ddb } from "@/lib/db/client";
import { asNonEmptyString, normalizeEventId } from "@/lib/utils";
import { getUserGroupIds, getSharedEventIdsForUserGroups } from "@/lib/db/access";
import { requireTable, withErrorHandler } from "@/lib/api";
import { withDdbRetry } from "@/lib/db/retry";

type EventSummary = {
  eventId: string;
  name: string;
  createdAt: string | null;
  updatedAt: string | null;
  photoCount: number;
  coverKey: string | null;
};

export const GET = withErrorHandler("GET /api/events", async (req: NextRequest) => {
  const user = await getVerifiedUser(req);
  if (!user?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const table = requireTable();

  const groups = await getUserGroupIds(ddb, table, user.sub);

  const result = await withDdbRetry(() => ddb.send(
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
  ));

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
    ddb,
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
});
