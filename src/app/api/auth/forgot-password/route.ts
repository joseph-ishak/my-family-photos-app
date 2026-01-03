import { NextRequest, NextResponse } from "next/server";
import {
  CognitoIdentityProviderClient,
  ForgotPasswordCommand,
} from "@aws-sdk/client-cognito-identity-provider";

const client = new CognitoIdentityProviderClient({
  region: process.env.COGNITO_REGION,
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any));
  const username =
    typeof body?.username === "string" ? body.username.trim() : "";

  if (!username) {
    return NextResponse.json({ error: "Missing username" }, { status: 400 });
  }

  try {
    await client.send(
      new ForgotPasswordCommand({
        ClientId: process.env.COGNITO_APP_CLIENT_ID!,
        Username: username,
      })
    );

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err: any) {
    console.error("Cognito forgot password error:", err);
    return NextResponse.json(
      { error: err?.message || "Forgot password failed" },
      { status: 400 }
    );
  }
}
