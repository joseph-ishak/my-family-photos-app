import { NextRequest, NextResponse } from "next/server";
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from "@aws-sdk/client-cognito-identity-provider";

const client = new CognitoIdentityProviderClient({
  region: process.env.COGNITO_REGION,
});

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();

  if (!username || !password) {
    return NextResponse.json(
      { error: "Missing username or password" },
      { status: 400 }
    );
  }

  try {
    const command = new InitiateAuthCommand({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: process.env.COGNITO_APP_CLIENT_ID!,
      AuthParameters: {
        USERNAME: username,
        PASSWORD: password,
      },
    });

    const response = await client.send(command);
    const result = response.AuthenticationResult;

    if (!result?.AccessToken || !result?.IdToken) {
      return NextResponse.json(
        { error: "Missing tokens from Cognito" },
        { status: 400 }
      );
    }

    const res = NextResponse.json({ success: true }, { status: 200 });
    const secure = process.env.NODE_ENV === "production";

    res.cookies.set("accessToken", result.AccessToken, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60,
    });

    res.cookies.set("idToken", result.IdToken, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60,
    });

    if (result.RefreshToken) {
      res.cookies.set("refreshToken", result.RefreshToken, {
        httpOnly: true,
        secure,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
    }

    return res;
  } catch (err: any) {
    console.error("Cognito login error:", err);
    return NextResponse.json(
      { error: err?.message || "Login failed" },
      { status: 400 }
    );
  }
}
