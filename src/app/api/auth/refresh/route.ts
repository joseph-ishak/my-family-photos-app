import { NextRequest, NextResponse } from "next/server";
import { InitiateAuthCommand } from "@aws-sdk/client-cognito-identity-provider";
import { cognito } from "@/lib/db/client";
import { handleRouteError } from "@/lib/api";

export async function POST(req: NextRequest) {
  const refreshToken = req.cookies.get("refreshToken")?.value;
  if (!refreshToken) {
    return NextResponse.json({ error: "No refresh token" }, { status: 401 });
  }

  try {
    const result = await cognito.send(
      new InitiateAuthCommand({
        AuthFlow: "REFRESH_TOKEN_AUTH",
        ClientId: process.env.COGNITO_APP_CLIENT_ID!,
        AuthParameters: {
          REFRESH_TOKEN: refreshToken,
        },
      })
    );

    const authResult = result.AuthenticationResult;
    if (!authResult?.AccessToken || !authResult?.IdToken) {
      return NextResponse.json(
        { error: "Refresh failed: missing tokens" },
        { status: 401 }
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

    // Cognito does not return a new refresh token on REFRESH_TOKEN_AUTH —
    // the existing one remains valid until its own expiry.

    return res;
  } catch (err) {
    return handleRouteError("POST /api/auth/refresh", err);
  }
}
