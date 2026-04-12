import { NextResponse } from "next/server";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getVerifiedUser } from "@/lib/auth-server";
import type { NextRequest } from "next/server";
import { ddb } from "@/lib/db/client";
import { withErrorHandler } from "@/lib/api";

const CF_BASE = (process.env.NEXT_PUBLIC_PREVIEWS_CDN_URL || "").replace(
  /\/$/,
  ""
);

function buildCdnUrl(key?: string | null) {
  if (!CF_BASE || !key) return null;
  return `${CF_BASE}/${encodeURI(key)}`;
}

export const GET = withErrorHandler("GET /api/events/summaries", async (req: NextRequest) => {
  const user = await getVerifiedUser(req);
  if (!user?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const TABLE = process.env.DYNAMO_TABLE_NAME!;

  // List all event records
  // Your design note says event records are stored at:
  // pk = "EVENT"
  // sk = "EVENT#<eventName>"
  const eventsRes = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :skPrefix)",
      ExpressionAttributeValues: {
        ":pk": "EVENT",
        ":skPrefix": "EVENT#",
      },
    })
  );

  const eventIds = (eventsRes.Items ?? [])
    .map((it: any) => String(it.sk || ""))
    .filter((sk) => sk.startsWith("EVENT#"))
    .map((sk) => sk.slice("EVENT#".length))
    .filter(Boolean);

  // For each event, fetch newest photo
  const summaries = await Promise.all(
    eventIds.map(async (eventId) => {
      const photosRes = await ddb.send(
        new QueryCommand({
          TableName: TABLE,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :photoPrefix)",
          ExpressionAttributeValues: {
            ":pk": `EVENT#${eventId}`,
            ":photoPrefix": "MEDIA#",
          },
          ScanIndexForward: false,
          Limit: 1,
        })
      );

      const p = photosRes.Items?.[0] as any | undefined;
      const coverKey =
        (p?.thumbnailKey as string | undefined) ||
        (p?.s3Key as string | undefined) ||
        (p?.key as string | undefined) ||
        null;

      const coverUrl =
        (p?.thumbnailUrl as string | undefined) || buildCdnUrl(coverKey);

      const updatedAt =
        (p?.takenAt as string | undefined) ||
        (p?.createdAt as string | undefined) ||
        null;

      return {
        id: eventId,
        coverUrl: coverUrl ?? null,
        updatedAt,
      };
    })
  );

  summaries.sort((a, b) => {
    const at = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const bt = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return bt - at;
  });

  return NextResponse.json({ events: summaries });
});
