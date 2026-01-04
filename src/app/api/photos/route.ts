// src/app/api/photos/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  QueryCommand,
  BatchGetCommandInput,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getVerifiedUser } from "@/lib/auth-server";

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: "us-west-2" })
);
const s3 = new S3Client({ region: "us-west-2" });

type DeleteItem = {
  pk: string;
  sk: string;
  key?: string;
};

const MAX_ITEMS = 200;

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function asNonEmptyString(v: unknown) {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : null;
}

async function signGetUrl(key?: string) {
  if (!key) return undefined;
  return await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME!,
      Key: key,
    }),
    { expiresIn: 3600 }
  );
}

function toPreviewPath(key: string) {
  if (key.startsWith("previews/")) return key.slice("previews/".length);
  if (key.startsWith("uploads/")) return key.slice("uploads/".length);
  return key;
}

function previewUrlForKey(key: string) {
  const base = process.env.PREVIEWS_CDN_URL;
  if (!base) throw new Error("Missing PREVIEWS_CDN_URL");
  const rel = toPreviewPath(key);
  return new URL(rel, base.endsWith("/") ? base : base + "/").toString();
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

async function getSharedEventIdsForGroups(
  table: string,
  groupIds: string[]
): Promise<Set<string>> {
  const out = new Set<string>();
  if (groupIds.length === 0) return out;

  for (const groupId of groupIds) {
    const res = await ddb.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
        ExpressionAttributeValues: {
          ":pk": `GROUP#${groupId}`,
          ":skPrefix": "SHARE#EVENT#",
        },
        ProjectionExpression: "eventId, SK",
      })
    );

    const items = (res.Items ?? []) as any[];
    for (const it of items) {
      const eid = asNonEmptyString(it?.eventId);
      if (eid) {
        out.add(eid);
        continue;
      }
      const sk = asNonEmptyString(it?.SK);
      if (sk && sk.startsWith("SHARE#EVENT#")) {
        out.add(sk.replace(/^SHARE#EVENT#/, ""));
      }
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

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? "20"), 50);
  const cursor = searchParams.get("cursor");

  let ExclusiveStartKey = cursor
    ? JSON.parse(Buffer.from(cursor, "base64").toString("utf8"))
    : undefined;

  try {
    const groupIds = await getUserGroupIds(table, user.sub);

    const visible: any[] = [];
    let lastEvaluated: any = null;

    while (visible.length < limit) {
      const result = await ddb.send(
        new QueryCommand({
          TableName: table,
          IndexName: "GSI1",
          KeyConditionExpression: "GSI1PK = :pk",
          ExpressionAttributeValues: {
            ":pk": "PHOTO",
          },
          Limit: Math.min(50, limit * 3),
          ScanIndexForward: false,
          ExclusiveStartKey,
          ProjectionExpression:
            "PK, SK, s3Key, thumbnailKey, eventId, takenAt, ownerUserId, mimeType, mediaType",
        })
      );

      const items = (result.Items ?? []) as any[];
      lastEvaluated = result.LastEvaluatedKey ?? null;
      ExclusiveStartKey = result.LastEvaluatedKey ?? undefined;

      if (items.length === 0) break;

      const owned = items.filter(
        (it) => asNonEmptyString(it?.ownerUserId) === user.sub
      );
      const notOwned = items.filter(
        (it) => asNonEmptyString(it?.ownerUserId) !== user.sub
      );

      const eventIdsToCheck = Array.from(
        new Set(
          notOwned
            .map((it) => asNonEmptyString(it?.eventId))
            .filter(Boolean)
            .filter((eid) => String(eid).toLowerCase() !== "default")
        )
      ) as string[];

      const sharedEvents = await getSharedEventIdsForGroups(table, groupIds);

      const allowedNotOwned = notOwned.filter((it) => {
        const eid = asNonEmptyString(it?.eventId);
        if (!eid) return false;
        if (eid.toLowerCase() === "default") return false;
        return sharedEvents.has(eid);
      });

      const allowed = [...owned, ...allowedNotOwned];

      for (const it of allowed) {
        if (visible.length >= limit) break;
        visible.push(it);
      }

      if (!ExclusiveStartKey) break;
    }

    const photos = await Promise.all(
      visible.map(async (item: any) => {
        const url = await signGetUrl(item.s3Key);

        const thumbnailUrl = item.thumbnailKey
          ? previewUrlForKey(item.thumbnailKey)
          : item.s3Key
          ? previewUrlForKey(item.s3Key)
          : undefined;

        const inferredMediaType =
          item.mediaType ??
          (typeof item.mimeType === "string" &&
          item.mimeType.startsWith("video/")
            ? "video"
            : "photo");

        return {
          key: item.s3Key,
          s3Key: item.s3Key,
          thumbnailKey: item.thumbnailKey,
          thumbnailUrl,
          mimeType: item.mimeType,
          mediaType: inferredMediaType,
          url,
          eventId: item.eventId,
          takenAt: item.takenAt,
          ownerUserId: item.ownerUserId,
          pk: item.PK,
          sk: item.SK,
        };
      })
    );

    const nextCursor = lastEvaluated
      ? Buffer.from(JSON.stringify(lastEvaluated), "utf8").toString("base64")
      : null;

    return NextResponse.json({ photos, nextCursor });
  } catch (err) {
    console.error("Error fetching photos:", err);
    return NextResponse.json({ photos: [] }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const user = await getVerifiedUser(req);
  if (!user?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);

    let items: DeleteItem[] = [];

    const body = await req.json().catch(() => null);
    const bodyItems = (body?.items ?? []) as DeleteItem[];

    if (Array.isArray(bodyItems) && bodyItems.length > 0) {
      items = bodyItems;
    } else {
      const key = searchParams.get("key");
      const pk = searchParams.get("pk");
      const sk = searchParams.get("sk");

      if (pk && sk) {
        items = [{ pk, sk, key: key ?? undefined }];
      }
    }

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "No items provided" }, { status: 400 });
    }

    if (items.length > MAX_ITEMS) {
      return NextResponse.json(
        { error: `Too many items. Max ${MAX_ITEMS}` },
        { status: 400 }
      );
    }

    const table = process.env.DYNAMO_TABLE_NAME!;
    const keys = items.map((i) => ({ PK: i.pk, SK: i.sk }));

    const keyChunks = chunk(keys, 100);

    const foundAll: any[] = [];
    for (const kc of keyChunks) {
      const got = await ddb.send(
        new BatchGetCommand({
          RequestItems: {
            [table]: {
              Keys: kc,
              ProjectionExpression:
                "PK, SK, ownerUserId, s3Key, thumbnailKey, eventId",
            },
          },
        })
      );

      const found = got.Responses?.[table] ?? [];
      foundAll.push(...found);
    }

    const deletable = foundAll.filter((x: any) => x.ownerUserId === user.sub);

    if (deletable.length === 0) {
      return NextResponse.json(
        { error: "Nothing deletable for this user" },
        { status: 403 }
      );
    }

    const txChunks = chunk(deletable, 25);
    for (const c of txChunks) {
      await ddb.send(
        new TransactWriteCommand({
          TransactItems: c.map((d: any) => ({
            Delete: {
              TableName: table,
              Key: { PK: d.PK, SK: d.SK },
              ConditionExpression: "ownerUserId = :u",
              ExpressionAttributeValues: { ":u": user.sub },
            },
          })),
        })
      );
    }

    const allKeys = deletable
      .flatMap((d: any) => [d.s3Key, d.thumbnailKey])
      .filter(Boolean) as string[];

    const uniqueKeys = Array.from(new Set(allKeys));
    const s3Objects = uniqueKeys.map((k) => ({ Key: k }));

    if (s3Objects.length === 1) {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: process.env.S3_BUCKET_NAME!,
          Key: s3Objects[0].Key!,
        })
      );
    } else if (s3Objects.length > 1) {
      const s3Chunks = chunk(s3Objects, 1000);
      for (const sc of s3Chunks) {
        await s3.send(
          new DeleteObjectsCommand({
            Bucket: process.env.S3_BUCKET_NAME!,
            Delete: { Objects: sc, Quiet: true },
          })
        );
      }
    }

    const eventCounts = new Map<string, number>();
    for (const d of deletable) {
      const ev = typeof d?.eventId === "string" ? d.eventId.trim() : "";
      if (!ev || ev.toLowerCase() === "default") continue;
      eventCounts.set(ev, (eventCounts.get(ev) ?? 0) + 1);
    }

    if (eventCounts.size > 0) {
      const now = new Date().toISOString();

      for (const [eventId, count] of eventCounts.entries()) {
        const delta = -Math.abs(count);

        await ddb.send(
          new UpdateCommand({
            TableName: table,
            Key: { PK: "EVENT", SK: `EVENT#${eventId}` },
            UpdateExpression: "ADD photoCount :d SET updatedAt = :now",
            ExpressionAttributeValues: {
              ":d": delta,
              ":now": now,
            },
          })
        );
      }
    }

    return NextResponse.json({
      success: true,
      deletedCount: deletable.length,
      requestedCount: items.length,
    });
  } catch (err: any) {
    console.error("DELETE /api/photos error", err);
    return NextResponse.json(
      { error: err?.message || "Delete failed" },
      { status: 500 }
    );
  }
}
