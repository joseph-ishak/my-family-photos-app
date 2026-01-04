import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

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

export function isDefaultEventId(eventId: unknown) {
  const v = typeof eventId === "string" ? eventId.trim() : "";
  if (!v) return true;
  return v.toLowerCase() === "default";
}

export function normalizeEventId(eventId: unknown) {
  const v = typeof eventId === "string" ? eventId.trim() : "";
  return v || "default";
}
