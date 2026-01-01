import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
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

export async function GET(req: NextRequest) {
  const user = await getVerifiedUser(req);
  if (!user?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await ddb.send(
      new QueryCommand({
        TableName: process.env.DYNAMO_TABLE_NAME!,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
        ExpressionAttributeValues: {
          ":pk": "EVENT",
          ":skPrefix": "EVENT#",
        },
        ProjectionExpression:
          "eventId, #name, createdAt, updatedAt, photoCount, coverKey, SK",
        ExpressionAttributeNames: {
          "#name": "name",
        },
      })
    );

    const items = (result.Items ?? []) as any[];

    const summaries: EventSummary[] = items
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

        return {
          eventId,
          name: nameRaw,
          createdAt,
          updatedAt,
          photoCount,
          coverKey,
        } satisfies EventSummary;
      })
      .filter(Boolean) as EventSummary[];

    summaries.sort((a, b) => a.name.localeCompare(b.name));

    const events = summaries.map((e) => e.eventId);

    return NextResponse.json({
      events,
      summaries,
    });
  } catch (err) {
    console.error("Error fetching events:", err);
    return NextResponse.json({ events: [], summaries: [] }, { status: 500 });
  }
}
