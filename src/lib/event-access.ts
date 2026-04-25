/**
 * Low-level DynamoDB helpers for querying the set of events a user can access.
 *
 * Separate from `src/lib/db/access.ts` (which handles group-based sharing)
 * so each concern stays focused and testable in isolation.
 */
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

/**
 * Returns the full set of event IDs that `userSub` is directly associated with
 * (i.e. events where a `USER#<sub> / EVENT#<id>` record exists in DynamoDB).
 *
 * Paginates automatically so all pages are collected even for users with many
 * events. Items with a blank or whitespace-only event ID are skipped.
 */
export async function getUserAccessibleEventIds(
  ddb: DynamoDBDocumentClient,
  tableName: string,
  userSub: string
): Promise<Set<string>> {
  const out = new Set<string>();

  let ExclusiveStartKey: Record<string, any> | undefined = undefined;

  while (true) {
    const result = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
        ExpressionAttributeValues: {
          ":pk": `USER#${userSub}`,
          ":skPrefix": "EVENT#",
        },
        ProjectionExpression: "SK",
        ExclusiveStartKey,
      })
    );

    for (const item of result.Items ?? []) {
      const sk = typeof (item as any)?.SK === "string" ? (item as any).SK : "";
      const eventId = sk.startsWith("EVENT#") ? sk.slice("EVENT#".length) : "";
      const trimmed = eventId.trim();
      if (trimmed) out.add(trimmed);
    }

    if (!result.LastEvaluatedKey) break;
    ExclusiveStartKey = result.LastEvaluatedKey as any;
  }

  return out;
}

/**
 * Returns `true` if `eventId` should be treated as the "default" (unfiled)
 * event — i.e. it is empty, whitespace-only, or the literal string "default"
 * (case-insensitive).
 */
export function isDefaultEventId(eventId: unknown) {
  const v = typeof eventId === "string" ? eventId.trim() : "";
  if (!v) return true;
  return v.toLowerCase() === "default";
}

/**
 * Normalises an event ID to a non-empty trimmed string, falling back to
 * `"default"` for blank or whitespace-only values.
 *
 * Note: this is a route-local variant that returns `"default"` instead of
 * `null`. Use `normalizeEventId` from `src/lib/utils.ts` for the null-returning
 * version used in DynamoDB PK construction.
 */
export function normalizeEventId(eventId: unknown) {
  const v = typeof eventId === "string" ? eventId.trim() : "";
  return v || "default";
}
