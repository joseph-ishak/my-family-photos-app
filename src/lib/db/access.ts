/**
 * Shared DynamoDB access-control helpers used across multiple route handlers.
 *
 * These functions were previously copy-pasted identically in events/route.ts
 * and photos/route.ts. Any change to access logic only needs to happen here.
 */

import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { asNonEmptyString, chunk } from "@/lib/utils";
import { Keys } from "@/lib/db/keys";

/**
 * Returns the list of group IDs the given user belongs to.
 */
export async function getUserGroupIds(
  ddb: DynamoDBDocumentClient,
  table: string,
  userSub: string
): Promise<string[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
      ExpressionAttributeValues: {
        ":pk": Keys.user(userSub),
        ":skPrefix": Keys.prefixes.group,
      },
      ProjectionExpression: "groupId, SK",
    })
  );

  const items = (res.Items ?? []) as Array<{
    groupId?: string;
    SK?: string;
  }>;

  const groupIds = items
    .map((it) => {
      const gid = asNonEmptyString(it?.groupId);
      if (gid) return gid;
      const sk = asNonEmptyString(it?.SK);
      if (!sk) return null;
      return sk.replace(/^GROUP#/, "");
    })
    .filter((id): id is string => id !== null);

  return Array.from(new Set(groupIds));
}

/**
 * Given a list of event IDs and a list of group IDs the current user belongs
 * to, returns the subset of event IDs that have been shared with at least one
 * of those groups.
 */
export async function getSharedEventIdsForUserGroups(
  ddb: DynamoDBDocumentClient,
  table: string,
  eventIds: string[],
  groupIds: string[]
): Promise<Set<string>> {
  const out = new Set<string>();
  if (eventIds.length === 0 || groupIds.length === 0) return out;

  const keys: { PK: string; SK: string }[] = [];
  for (const eventId of eventIds) {
    for (const groupId of groupIds) {
      keys.push({
        PK: Keys.event(eventId),
        SK: Keys.shareGroup(groupId),
      });
    }
  }

  for (const c of chunk(keys, 100)) {
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

    const found = (got.Responses?.[table] ?? []) as Array<{
      eventId?: string;
      PK?: string;
    }>;
    for (const it of found) {
      const eid = asNonEmptyString(it?.eventId);
      if (eid) {
        out.add(eid);
        continue;
      }
      const pk = asNonEmptyString(it?.PK);
      if (pk?.startsWith("EVENT#")) out.add(pk.replace(/^EVENT#/, ""));
    }
  }

  return out;
}

/**
 * Returns a map of userId → nickname for the given list of user IDs.
 * Users without a profile or nickname are omitted from the map.
 */
export async function getNicknamesForUsers(
  ddb: DynamoDBDocumentClient,
  table: string,
  userIds: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  if (unique.length === 0) return out;

  const keys = unique.map((sub) => ({
    PK: Keys.user(sub),
    SK: "PROFILE",
  }));

  for (const c of chunk(keys, 100)) {
    const got = await ddb.send(
      new BatchGetCommand({
        RequestItems: {
          [table]: {
            Keys: c,
            ProjectionExpression: "PK, nickname",
          },
        },
      })
    );

    const found = (got.Responses?.[table] ?? []) as Array<{
      PK?: string;
      nickname?: string;
    }>;
    for (const it of found) {
      const pk = asNonEmptyString(it?.PK);
      const nick = asNonEmptyString(it?.nickname);
      if (!pk?.startsWith("USER#") || !nick) continue;
      out.set(pk.replace(/^USER#/, ""), nick);
    }
  }

  return out;
}
