/**
 * User profile endpoints.
 *
 * GET — fetch the authenticated user's profile. Creates a skeleton profile on
 *       first access so the record always exists after the first GET.
 * PUT — update profile fields (nickname, username, firstName, lastName,
 *       avatarKey). Validates username format and marks `profileComplete` once
 *       all required fields are present.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getVerifiedUser } from "@/lib/auth-server";
import { ddb, s3 } from "@/lib/db/client";
import { withErrorHandler } from "@/lib/api";

/** Returns the current UTC time as an ISO 8601 string. */
function now() {
  return new Date().toISOString();
}

/**
 * Returns `true` if the profile has all three required fields (username,
 * firstName, lastName) filled with non-empty strings.
 */
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

/**
 * Derives a display nickname from the Cognito token payload, falling back
 * through `nickname` → `preferred_username` → email local-part → "User".
 */
function defaultNickname(user: any) {
  if (typeof user.nickname === "string" && user.nickname) return user.nickname;
  if (typeof user.preferred_username === "string" && user.preferred_username)
    return user.preferred_username;
  if (typeof user.email === "string") return user.email.split("@")[0];
  return "User";
}

export const GET = withErrorHandler("GET /api/profile", async (req: NextRequest) => {
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
    // username, firstName, lastName are intentionally omitted from the skeleton
    // record. DynamoDB's GSI2 uses `username` as a key attribute and rejects
    // empty strings as key values. Omitting the attribute is safe — the item
    // simply won't appear in GSI2 until the user saves a real username via PUT.
    const skeleton: Record<string, unknown> = {
      PK: pk,
      SK: sk,
      entityType: "PROFILE",
      nickname: defaultNickname(user),
      avatarKey: null,
      profileComplete: false,
      createdAt: now(),
      updatedAt: now(),
    };

    await ddb.send(
      new PutCommand({
        TableName: process.env.DYNAMO_TABLE_NAME!,
        Item: skeleton,
        ConditionExpression: "attribute_not_exists(PK)",
      })
    );

    profile = skeleton;
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
    profile: {
      ...profile,
      // Default empty-string fields for new users whose skeleton record was
      // written without these attributes (see comment above).
      username: profile.username ?? "",
      firstName: profile.firstName ?? "",
      lastName: profile.lastName ?? "",
      avatarUrl,
      profileComplete: complete,
    },
  });
});

export const PUT = withErrorHandler("PUT /api/profile", async (req: NextRequest) => {
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
});
