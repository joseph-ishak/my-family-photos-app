import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: "us-west-2" })
);

export async function GET() {
  try {
    const result = await ddb.send(
      new QueryCommand({
        TableName: process.env.DYNAMO_TABLE_NAME!,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
        ExpressionAttributeValues: {
          ":pk": "EVENT",
          ":skPrefix": "EVENT#",
        },
        ProjectionExpression: "eventId, SK",
      })
    );

    const events = Array.from(
      new Set(
        (result.Items ?? [])
          .map((item: any) => (item?.eventId as string | undefined) ?? null)
          .filter(Boolean) as string[]
      )
    )
      .filter((e) => e.toLowerCase() !== "default")
      .sort((a, b) => a.localeCompare(b));

    return NextResponse.json({ events });
  } catch (err) {
    console.error("Error fetching events:", err);
    return NextResponse.json({ events: [] }, { status: 500 });
  }
}
