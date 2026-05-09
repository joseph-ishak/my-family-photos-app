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
import { getUserGroupIds, getSharedEventIdsForUserGroups, getNicknamesForUsers } from "@/lib/db/access";
import { requireTable, withErrorHandler } from "@/lib/api";
import { withDdbRetry } from "@/lib/db/retry";
import { encodeCursor, decodeCursor } from "@/lib/cursor";

type DeleteItem = {
  pk: string;
  sk: string;
  key?: string;
};

const MAX_ITEMS = 200;


/**
 * Returns a 1-hour pre-signed S3 GetObject URL for the given key, or
 * `undefined` if `key` is absent (e.g. the item has no original yet).
 */
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

/**
 * Strips the `"previews/"` prefix from a key so it can be appended to the
 * CloudFront CDN base URL. Keys under `"uploads/"` are originals that are NOT
 * routed through the previews CDN — they are returned unchanged so a broken CDN
 * URL is never constructed.
 */
function toPreviewPath(key: string) {
  if (key.startsWith("previews/")) return key.slice("previews/".length);
  // "uploads/" keys are originals — they are NOT served via the previews CDN.
  // Stripping that prefix would build a broken CDN URL, so we pass through as-is.
  return key;
}

/**
 * Builds a full CloudFront CDN URL for a given S3 key.
 *
 * @throws {Error} If `PREVIEWS_CDN_URL` is not set in the environment.
 */
function previewUrlForKey(key: string) {
  const base = process.env.PREVIEWS_CDN_URL;
  if (!base) throw new Error("Missing PREVIEWS_CDN_URL");
  const rel = toPreviewPath(key);
  return new URL(rel, base.endsWith("/") ? base : base + "/").toString();
}

/**
 * Determines the media type of a DynamoDB item. Prefers the explicit
 * `mediaType` field, then falls back to inspecting `mimeType` for older records
 * that pre-date the `mediaType` column.
 */
function inferMediaType(item: any): "photo" | "video" {
  const mt = asNonEmptyString(item?.mediaType);
  if (mt === "video") return "video";
  if (mt === "photo") return "photo";

  const mime = asNonEmptyString(item?.mimeType) ?? "";
  if (mime.startsWith("video/")) return "video";
  return "photo";
}

/**
 * GET /api/photos
 *
 * Returns a paginated list of photos visible to the authenticated user.
 *
 * Query params:
 *   eventId   — filter to a specific event (access-controlled)
 *   mediaType — "photo" | "video" — filter by media type
 *   limit     — page size 1–50 (default 20)
 *   cursor    — opaque AES-256-GCM token from a previous response
 *
 * When `eventId` is given, access is checked (owner or shared group).
 * Without `eventId`, the GSI1 global feed is used and filtered to items the
 * user owns or can see via group sharing.
 *
 * Response: { photos: Photo[], nextCursor: string | null }
 */
export const GET = withErrorHandler("GET /api/photos", async (req: NextRequest) => {
  const user = await getVerifiedUser(req);
  if (!user?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const table = requireTable();

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Math.max(1, Number(searchParams.get("limit") ?? "20") || 20), 50);
  const cursor = searchParams.get("cursor");
  const requestedEventId = normalizeEventId(searchParams.get("eventId"));
  const mediaTypeParam = searchParams.get("mediaType");
  const mediaTypeFilter =
    mediaTypeParam === "photo" || mediaTypeParam === "video"
      ? mediaTypeParam
      : null;

  // Build a FilterExpression that mirrors inferMediaType():
  //   video  → mediaType = "video"  OR  mimeType begins_with "video/"
  //   photo  → NOT (mediaType = "video" OR mimeType begins_with "video/")
  // This handles older records that only have mimeType stored.
  const mediaFilterExpr =
    mediaTypeFilter === "video"
      ? {
          FilterExpression:
            "mediaType = :mtVideo OR begins_with(mimeType, :mimeVideo)",
          ExtraValues: { ":mtVideo": "video", ":mimeVideo": "video/" },
        }
      : mediaTypeFilter === "photo"
      ? {
          FilterExpression:
            "(attribute_not_exists(mediaType) OR mediaType <> :mtVideo)" +
            " AND (attribute_not_exists(mimeType) OR NOT begins_with(mimeType, :mimeVideo))",
          ExtraValues: { ":mtVideo": "video", ":mimeVideo": "video/" },
        }
      : null;

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
        ...(mediaFilterExpr
          ? {
              FilterExpression: mediaFilterExpr.FilterExpression,
              ExpressionAttributeValues: {
                ":pk": pk,
                ":skPrefix": "MEDIA#",
                ...mediaFilterExpr.ExtraValues,
              },
            }
          : {
              ExpressionAttributeValues: {
                ":pk": pk,
                ":skPrefix": "MEDIA#",
              },
            }),
        Limit: limit,
        ScanIndexForward: false,
        ExclusiveStartKey,
        ProjectionExpression:
          "PK, SK, s3Key, thumbnailKey, archiveKey, eventId, takenAt, ownerUserId, mimeType, mediaType",
      })
    );

    const items = (result.Items ?? []) as any[];
    const lastEvaluated = result.LastEvaluatedKey ?? null;

    const ownerIds = Array.from(
      new Set(items.map((it) => asNonEmptyString(it?.ownerUserId)).filter(Boolean) as string[])
    );
    const nickByOwner = await getNicknamesForUsers(ddb, table, ownerIds);

    const photos = await Promise.all(
      items.map(async (item: any) => {
        const url = await signGetUrl(item.s3Key);

        // Only serve thumbnails via the CDN — never fall back to the raw s3Key,
        // which lives under uploads/ and is not routed through the previews CDN.
        // Videos without a poster frame will have no thumbnailUrl; the UI shows
        // a placeholder instead.
        const thumbnailUrl = item.thumbnailKey
          ? previewUrlForKey(item.thumbnailKey)
          : undefined;

        const ownerUserId = asNonEmptyString(item.ownerUserId);

        return {
          key: item.s3Key,
          s3Key: item.s3Key,
          thumbnailKey: item.thumbnailKey,
          thumbnailUrl,
          archiveKey: item.archiveKey,
          mimeType: item.mimeType,
          mediaType: inferMediaType(item),
          url,
          eventId: item.eventId,
          takenAt: item.takenAt,
          ownerUserId,
          ownerNickname: ownerUserId ? nickByOwner.get(ownerUserId) ?? null : null,
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

  const gsiRes = await withDdbRetry(() => ddb.send(
    new QueryCommand({
      TableName: table,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk",
      ...(mediaFilterExpr
        ? {
            FilterExpression: mediaFilterExpr.FilterExpression,
            ExpressionAttributeValues: {
              ":pk": "PHOTO",
              ...mediaFilterExpr.ExtraValues,
            },
          }
        : {
            ExpressionAttributeValues: {
              ":pk": "PHOTO",
            },
          }),
      Limit: limit,
      ScanIndexForward: false,
      ExclusiveStartKey,
      ProjectionExpression:
        "PK, SK, GSI1PK, GSI1SK, s3Key, thumbnailKey, archiveKey, eventId, takenAt, ownerUserId, mimeType, mediaType",
    })
  ));

  const gsiItems = (gsiRes.Items ?? []) as any[];
  const lastEvaluated = gsiRes.LastEvaluatedKey ?? null;

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

  const ownerIds = Array.from(
    new Set(visible.map((it) => asNonEmptyString(it?.ownerUserId)).filter(Boolean) as string[])
  );
  const nickByOwner = await getNicknamesForUsers(ddb, table, ownerIds);

  const photos = await Promise.all(
    visible.map(async (item: any) => {
      const url = await signGetUrl(item.s3Key);

      // Only serve thumbnails via the CDN — never fall back to the raw s3Key,
      // which lives under uploads/ and is not routed through the previews CDN.
      const thumbnailUrl = item.thumbnailKey
        ? previewUrlForKey(item.thumbnailKey)
        : undefined;

      const ownerUserId = asNonEmptyString(item.ownerUserId);

      return {
        key: item.s3Key,
        s3Key: item.s3Key,
        thumbnailKey: item.thumbnailKey,
        thumbnailUrl,
        archiveKey: item.archiveKey,
        mimeType: item.mimeType,
        mediaType: inferMediaType(item),
        url,
        eventId: item.eventId,
        takenAt: item.takenAt,
        ownerUserId,
        ownerNickname: ownerUserId ? nickByOwner.get(ownerUserId) ?? null : null,
        pk: item.PK,
        sk: item.SK,
      };
    })
  );

  return NextResponse.json({
    photos,
    nextCursor: encodeCursor(lastEvaluated),
  });
});

/**
 * DELETE /api/photos
 *
 * Deletes one or more photos. Accepts either a JSON body `{ items: DeleteItem[] }`
 * (batch) or `?pk=&sk=&key=` query params (single item). Only items owned by
 * the authenticated user are deleted; the rest are silently skipped.
 *
 * After removing DynamoDB records and S3 objects, the `photoCount` on each
 * affected event is decremented via an `ADD photoCount -N` expression.
 *
 * Response: { success: true; deletedCount: number; requestedCount: number }
 */
export const DELETE = withErrorHandler("DELETE /api/photos", async (req: NextRequest) => {
  const user = await getVerifiedUser(req);
  if (!user?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
});
