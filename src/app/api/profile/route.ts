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

function isProfileComplete(p: any) {
  return Boolean(
    typeof p?.username === "string" &&
      p.username.trim() &&
      typeof p?.firstName === "string" &&
      p.firstName.trim() &&
      typeof p?.lastName === "string" &&
      p.lastName.trim()
  );
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
      username: "",
      firstName: "",
      lastName: "",
      avatarKey: null,
      profileComplete: false,
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

  const complete = isProfileComplete(profile);
  if (profile.profileComplete !== complete) {
    profile.profileComplete = complete;
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
    profile: { ...profile, avatarUrl, profileComplete: complete },
  });
}

export async function PUT(req: NextRequest) {
  const user = await getVerifiedUser(req);
  if (!user?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { nickname, avatarKey, username, firstName, lastName } =
    await req.json();

  const nick = typeof nickname === "string" ? nickname.trim().slice(0, 32) : "";
  const usern =
    typeof username === "string" ? username.trim().toLowerCase() : "";
  const fn = typeof firstName === "string" ? firstName.trim().slice(0, 32) : "";
  const ln = typeof lastName === "string" ? lastName.trim().slice(0, 32) : "";

  if (!nick)
    return NextResponse.json({ error: "Nickname required" }, { status: 400 });
  if (!fn)
    return NextResponse.json({ error: "First name required" }, { status: 400 });
  if (!ln)
    return NextResponse.json({ error: "Last name required" }, { status: 400 });
  if (!usern)
    return NextResponse.json({ error: "Username required" }, { status: 400 });

  if (!/^[a-z0-9_]{3,20}$/.test(usern)) {
    return NextResponse.json(
      {
        error:
          "Username must be 3 to 20 characters and use letters numbers or underscore",
      },
      { status: 400 }
    );
  }

  const complete = isProfileComplete({
    username: usern,
    firstName: fn,
    lastName: ln,
  });

  const result = await ddb.send(
    new UpdateCommand({
      TableName: process.env.DYNAMO_TABLE_NAME!,
      Key: { PK: `USER#${user.sub}`, SK: "PROFILE" },
      UpdateExpression:
        "SET nickname = :n, avatarKey = :a, username = :un, firstName = :fn, lastName = :ln, profileComplete = :pc, updatedAt = :u, entityType = :t",
      ExpressionAttributeValues: {
        ":n": nick,
        ":a": avatarKey ?? null,
        ":un": usern,
        ":fn": fn,
        ":ln": ln,
        ":pc": complete,
        ":u": now(),
        ":t": "PROFILE",
      },
      ReturnValues: "ALL_NEW",
    })
  );

  return NextResponse.json({ profile: result.Attributes });
}
