import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getVerifiedUser } from "@/lib/auth-server";

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: "us-west-2" })
);

const s3 = new S3Client({ region: "us-west-2" });

function now() {
  return new Date().toISOString();
}

function defaultNickname(user: any) {
  if (typeof user.nickname === "string" && user.nickname) return user.nickname;
  if (typeof user.preferred_username === "string" && user.preferred_username)
    return user.preferred_username;
  if (typeof user.email === "string") return user.email.split("@")[0];
  return "User";
}

export async function GET(req: NextRequest) {
  const user = await getVerifiedUser(req);
  if (!user?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pk = `USER#${user.sub}`;
  const sk = "PROFILE";

  const result = await ddb.send(
    new GetCommand({
      TableName: process.env.DYNAMO_TABLE_NAME!,
      Key: { PK: pk, SK: sk },
    })
  );

  let profile = result.Item;

  if (!profile) {
    profile = {
      PK: pk,
      SK: sk,
      entityType: "PROFILE",
      nickname: defaultNickname(user),
      avatarKey: null,
      createdAt: now(),
      updatedAt: now(),
    };

    await ddb.send(
      new PutCommand({
        TableName: process.env.DYNAMO_TABLE_NAME!,
        Item: profile,
        ConditionExpression: "attribute_not_exists(PK)",
      })
    );
  }

  let avatarUrl = null;
  if (profile.avatarKey) {
    avatarUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME!,
        Key: profile.avatarKey,
      }),
      { expiresIn: 3600 }
    );
  }

  return NextResponse.json({
    profile: { ...profile, avatarUrl },
  });
}

export async function PUT(req: NextRequest) {
  const user = await getVerifiedUser(req);
  if (!user?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { nickname, avatarKey } = await req.json();

  if (!nickname || typeof nickname !== "string") {
    return NextResponse.json({ error: "Nickname required" }, { status: 400 });
  }

  const result = await ddb.send(
    new UpdateCommand({
      TableName: process.env.DYNAMO_TABLE_NAME!,
      Key: { PK: `USER#${user.sub}`, SK: "PROFILE" },
      UpdateExpression:
        "SET nickname = :n, avatarKey = :a, updatedAt = :u, entityType = :t",
      ExpressionAttributeValues: {
        ":n": nickname.trim().slice(0, 32),
        ":a": avatarKey ?? null,
        ":u": now(),
        ":t": "PROFILE",
      },
      ReturnValues: "ALL_NEW",
    })
  );

  return NextResponse.json({ profile: result.Attributes });
}
