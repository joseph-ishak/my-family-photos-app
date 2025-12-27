import { NextRequest } from "next/server";
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { serialize } from "cookie";

const client = new CognitoIdentityProviderClient({
  region: process.env.COGNITO_REGION,
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const username = body.username;
  const password = body.password;

  if (!username || !password) {
    return new Response(
      JSON.stringify({ error: "Missing username or password" }),
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

    const cookies = [
      serialize("accessToken", response.AuthenticationResult?.AccessToken!, {
        httpOnly: true,
        path: "/",
        secure: process.env.NODE_ENV === "production",
        maxAge: 3600,
      }),
      serialize("idToken", response.AuthenticationResult?.IdToken!, {
        httpOnly: true,
        path: "/",
        secure: process.env.NODE_ENV === "production",
        maxAge: 3600,
      }),
      serialize("refreshToken", response.AuthenticationResult?.RefreshToken!, {
        httpOnly: true,
        path: "/",
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 60 * 24 * 30,
      }),
    ];

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Set-Cookie": cookies.join(",") },
    });
  } catch (err: any) {
    console.error("Cognito login error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
    });
  }
}
