import { NextRequest, NextResponse } from "next/server";
import {
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { cognito } from "@/lib/db/client";
import { withErrorHandler } from "@/lib/api";

export const POST = withErrorHandler("POST /api/auth/login", async (req: NextRequest) => {
  const { username, password, newPassword } = await req.json();

  if (!username || !password) {
    return NextResponse.json(
      { error: "Missing username or password" },
      { status: 400 }
    );
  }

  const init = await cognito.send(
    new InitiateAuthCommand({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: process.env.COGNITO_APP_CLIENT_ID!,
      AuthParameters: {
        USERNAME: username,
        PASSWORD: password,
      },
    })
  );

  let authResult = init.AuthenticationResult;

  if (init.ChallengeName === "NEW_PASSWORD_REQUIRED") {
    if (!newPassword) {
      return NextResponse.json(
        {
          error: "NEW_PASSWORD_REQUIRED",
          message: "User must set a new password before tokens are issued.",
        },
        { status: 409 }
      );
    }

    const challenge = await cognito.send(
      new RespondToAuthChallengeCommand({
        ClientId: process.env.COGNITO_APP_CLIENT_ID!,
        ChallengeName: "NEW_PASSWORD_REQUIRED",
        Session: init.Session,
        ChallengeResponses: {
          USERNAME: username,
          NEW_PASSWORD: newPassword,
        },
      })
    );

    authResult = challenge.AuthenticationResult;
  }

  if (!authResult?.AccessToken || !authResult?.IdToken) {
    return NextResponse.json(
      { error: "Missing tokens from Cognito" },
      { status: 400 }
    );
  }

  const res = NextResponse.json({ success: true }, { status: 200 });
  const secure = process.env.NODE_ENV === "production";

  res.cookies.set("accessToken", authResult.AccessToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60,
  });

  res.cookies.set("idToken", authResult.IdToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60,
  });

  if (authResult.RefreshToken) {
    res.cookies.set("refreshToken", authResult.RefreshToken, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  return res;
});
