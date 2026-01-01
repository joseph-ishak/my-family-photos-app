import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  BatchGetCommand,
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

export async function GET(req: NextRequest) {
  const user = await getVerifiedUser(req);
  if (!user?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? "20"), 50);
  const cursor = searchParams.get("cursor");

  const ExclusiveStartKey = cursor
    ? JSON.parse(Buffer.from(cursor, "base64").toString("utf8"))
    : undefined;

  try {
    const result = await ddb.send(
      new QueryCommand({
        TableName: process.env.DYNAMO_TABLE_NAME!,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :pk",
        ExpressionAttributeValues: {
          ":pk": "PHOTO",
        },
        Limit: limit,
        ScanIndexForward: false,
        ExclusiveStartKey,
        ProjectionExpression:
          "PK, SK, s3Key, thumbnailKey, eventId, takenAt, ownerUserId, mimeType, mediaType",
      })
    );

    const photos = await Promise.all(
      (result.Items || []).map(async (item: any) => {
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

    const nextCursor = result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey), "utf8").toString(
          "base64"
        )
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

    console.log("DELETE /api/photos received", {
      userSub: user.sub,
      itemsCount: items.length,
      sample: items[0],
    });

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

    console.log("DELETE /api/photos batchGet found", {
      foundCount: foundAll.length,
    });

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
