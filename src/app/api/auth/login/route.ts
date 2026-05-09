/**
 * POST /api/auth/login
 *
 * Authenticates a user against Cognito using the USER_PASSWORD_AUTH flow and
 * sets `accessToken`, `idToken`, and `refreshToken` as HttpOnly cookies.
 *
 * Handles the `NEW_PASSWORD_REQUIRED` challenge: if Cognito demands a password
 * change (e.g. first login for an admin-created account), the caller must
 * include `newPassword` in the same request to complete the challenge in one
 * round-trip.
 *
 * Responses:
 *   200 — authenticated; cookies are set.
 *   400 — missing credentials or Cognito did not return tokens.
 *   409 — `NEW_PASSWORD_REQUIRED` challenge raised but no `newPassword` supplied.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { cognito } from "@/lib/db/client";
import { withErrorHandler } from "@/lib/api";

/**
 * Maps Cognito exception names to a human-readable message + HTTP status.
 * Returning `null` means the error is unexpected and should bubble up as a 500.
 */
function cognitoAuthError(err: unknown): NextResponse | null {
  const name = (err as { name?: string })?.name;
  const msg  = (err as { message?: string })?.message ?? "";

  switch (name) {
    case "NotAuthorizedException":
      return NextResponse.json({ error: "Incorrect username or password." }, { status: 401 });
    case "UserNotFoundException":
      // Same message as above — don't reveal which field was wrong.
      return NextResponse.json({ error: "Incorrect username or password." }, { status: 401 });
    case "InvalidPasswordException":
      // Cognito's message describes the policy violation — forward it to the user.
      return NextResponse.json({ error: msg || "Password does not meet requirements." }, { status: 400 });
    case "InvalidParameterException":
      return NextResponse.json({ error: msg || "Invalid request." }, { status: 400 });
    case "LimitExceededException":
    case "TooManyRequestsException":
      return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
    case "UserNotConfirmedException":
      return NextResponse.json({ error: "Account not confirmed. Check your email." }, { status: 400 });
    case "ExpiredCodeException":
      return NextResponse.json({ error: "Session expired. Please sign in again." }, { status: 400 });
    default:
      return null;
  }
}

export const POST = withErrorHandler("POST /api/auth/login", async (req: NextRequest) => {
  const { username, password, newPassword } = await req.json();

  if (!username || !password) {
    return NextResponse.json(
      { error: "Missing username or password" },
      { status: 400 }
    );
  }

  let init;
  try {
    init = await cognito.send(
      new InitiateAuthCommand({
        AuthFlow: "USER_PASSWORD_AUTH",
        ClientId: process.env.COGNITO_APP_CLIENT_ID!,
        AuthParameters: {
          USERNAME: username,
          PASSWORD: password,
        },
      })
    );
  } catch (err) {
    return cognitoAuthError(err) ?? (() => { throw err; })();
  }

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

    try {
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
    } catch (err) {
      return cognitoAuthError(err) ?? (() => { throw err; })();
    }
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
