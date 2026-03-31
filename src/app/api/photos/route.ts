// src/app/api/photos/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  BatchGetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getVerifiedUser } from "@/lib/auth-server";
import { ddb, s3 } from "@/lib/db/client";
import { asNonEmptyString, normalizeEventId, chunk } from "@/lib/utils";
import { getUserGroupIds, getSharedEventIdsForUserGroups } from "@/lib/db/access";
import { requireTable } from "@/lib/api";
import { encodeCursor, decodeCursor } from "@/lib/cursor";

type DeleteItem = {
  pk: string;
  sk: string;
  key?: string;
};

const MAX_ITEMS = 200;


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

function inferMediaType(item: any): "photo" | "video" {
  const mt = asNonEmptyString(item?.mediaType);
  if (mt === "video") return "video";
  if (mt === "photo") return "photo";

  const mime = asNonEmptyString(item?.mimeType) ?? "";
  if (mime.startsWith("video/")) return "video";
  return "photo";
}

export async function GET(req: NextRequest) {
  const user = await getVerifiedUser(req);
  if (!user?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const table = requireTable();

    const { searchParams } = new URL(req.url);
    const limit = Math.min(Number(searchParams.get("limit") ?? "20"), 50);
    const cursor = searchParams.get("cursor");
    const requestedEventId = normalizeEventId(searchParams.get("eventId"));

    const ExclusiveStartKey = decodeCursor(cursor);

    const groupIds = await getUserGroupIds(ddb, table, user.sub);

    if (requestedEventId) {
      const ownerRes = await ddb.send(
        new GetCommand({
          TableName: table,
          Key: { PK: "EVENT", SK: `EVENT#${requestedEventId}` },
          ProjectionExpression: "ownerUserId",
        })
      );

      const ownerUserId = asNonEmptyString((ownerRes.Item as any)?.ownerUserId);
      const isOwner = ownerUserId === user.sub;

      const sharedSet = await getSharedEventIdsForUserGroups(
        ddb,
        table,
        [requestedEventId],
        groupIds
      );
      const isShared = sharedSet.has(requestedEventId);

      if (!isOwner && !isShared) {
        return NextResponse.json(
          { photos: [], nextCursor: null },
          { status: 403 }
        );
      }

      const pk = `EVENT#${requestedEventId}`;

      const result = await ddb.send(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
          ExpressionAttributeValues: {
            ":pk": pk,
            ":skPrefix": "MEDIA#",
          },
          Limit: limit,
          ScanIndexForward: false,
          ExclusiveStartKey,
          ProjectionExpression:
            "PK, SK, s3Key, thumbnailKey, eventId, takenAt, ownerUserId, ownerNickname, mimeType, mediaType",
        })
      );

      const items = (result.Items ?? []) as any[];
      const lastEvaluated = result.LastEvaluatedKey ?? null;

      const photos = await Promise.all(
        items.map(async (item: any) => {
          const url = await signGetUrl(item.s3Key);

          const thumbnailUrl = item.thumbnailKey
            ? previewUrlForKey(item.thumbnailKey)
            : item.s3Key
            ? previewUrlForKey(item.s3Key)
            : undefined;

          return {
            key: item.s3Key,
            s3Key: item.s3Key,
            thumbnailKey: item.thumbnailKey,
            thumbnailUrl,
            mimeType: item.mimeType,
            mediaType: inferMediaType(item),
            url,
            eventId: item.eventId,
            takenAt: item.takenAt,
            ownerUserId: asNonEmptyString(item.ownerUserId),
            ownerNickname: asNonEmptyString(item.ownerNickname) ?? null,
            pk: item.PK,
            sk: item.SK,
          };
        })
      );

      return NextResponse.json({
        photos,
        nextCursor: encodeCursor(lastEvaluated),
      });
    }

    const gsiRes = await ddb.send(
      new QueryCommand({
        TableName: table,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: {
          ":pk": "PHOTO",
        },
        Limit: limit,
        ScanIndexForward: false,
        ExclusiveStartKey,
        ProjectionExpression:
          "PK, SK, GSI1PK, GSI1SK, s3Key, thumbnailKey, eventId, takenAt, ownerUserId, ownerNickname, mimeType, mediaType",
      })
    );

    const gsiItems = (gsiRes.Items ?? []) as any[];
    const lastEvaluated = gsiRes.LastEvaluatedKey ?? null;

    console.log("[api/photos] gsi page", {
      requestedLimit: limit,
      returnedItems: gsiItems.length,
      hasLastEvaluatedKey: Boolean(lastEvaluated),
    });

    const owned = gsiItems.filter(
      (it) => asNonEmptyString(it?.ownerUserId) === user.sub
    );

    const notOwned = gsiItems.filter(
      (it) => asNonEmptyString(it?.ownerUserId) !== user.sub
    );

    const candidateEventIds = Array.from(
      new Set(
        notOwned.map((it) => normalizeEventId(it?.eventId)).filter(Boolean)
      )
    ) as string[];

    const sharedEvents = await getSharedEventIdsForUserGroups(
      ddb,
      table,
      candidateEventIds,
      groupIds
    );

    const allowedNotOwned = notOwned.filter((it) => {
      const eid = normalizeEventId(it?.eventId);
      if (!eid) return false;
      return sharedEvents.has(eid);
    });

    const visible = [...owned, ...allowedNotOwned];

    const photos = await Promise.all(
      visible.map(async (item: any) => {
        const url = await signGetUrl(item.s3Key);

        const thumbnailUrl = item.thumbnailKey
          ? previewUrlForKey(item.thumbnailKey)
          : item.s3Key
          ? previewUrlForKey(item.s3Key)
          : undefined;

        return {
          key: item.s3Key,
          s3Key: item.s3Key,
          thumbnailKey: item.thumbnailKey,
          thumbnailUrl,
          mimeType: item.mimeType,
          mediaType: inferMediaType(item),
          url,
          eventId: item.eventId,
          takenAt: item.takenAt,
          ownerUserId: asNonEmptyString(item.ownerUserId),
          ownerNickname: asNonEmptyString(item.ownerNickname) ?? null,
          pk: item.PK,
          sk: item.SK,
        };
      })
    );

    return NextResponse.json({
      photos,
      nextCursor: encodeCursor(lastEvaluated),
    });
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

    const table = requireTable();
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
