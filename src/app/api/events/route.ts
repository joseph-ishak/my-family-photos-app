import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: "us-west-2" })
);

export async function GET() {
  try {
    // Scan for all items with PK starting with "EVENT#"
    const result = await ddb.send(
      new ScanCommand({
        TableName: process.env.DYNAMO_TABLE_NAME!,
        FilterExpression: "begins_with(PK, :eventPrefix)",
        ExpressionAttributeValues: {
          ":eventPrefix": "EVENT#",
        },
        ProjectionExpression: "eventId", // or whatever attribute stores the event name
      })
    );

    // Extract unique event names/IDs
    const events = Array.from(
      new Set(result.Items?.map((item) => item.eventId).filter(Boolean) ?? [])
    );
    // ...existing code...
    return NextResponse.json({ events });
  } catch (err) {
    console.error("Error fetching events:", err);
    return NextResponse.json({ events: [] }, { status: 500 });
  }
}
