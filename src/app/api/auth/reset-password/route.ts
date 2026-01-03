import { NextRequest, NextResponse } from "next/server";
import {
  CognitoIdentityProviderClient,
  ConfirmForgotPasswordCommand,
} from "@aws-sdk/client-cognito-identity-provider";

const client = new CognitoIdentityProviderClient({
  region: process.env.COGNITO_REGION,
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any));

  const username =
    typeof body?.username === "string" ? body.username.trim() : "";
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const newPassword =
    typeof body?.newPassword === "string" ? body.newPassword : "";

  if (!username || !code || !newPassword) {
    return NextResponse.json(
      { error: "Missing username, code, or newPassword" },
      { status: 400 }
    );
  }

  try {
    await client.send(
      new ConfirmForgotPasswordCommand({
        ClientId: process.env.COGNITO_APP_CLIENT_ID!,
        Username: username,
        ConfirmationCode: code,
        Password: newPassword,
      })
    );

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err: any) {
    console.error("Cognito reset password error:", err);
    return NextResponse.json(
      { error: err?.message || "Reset password failed" },
      { status: 400 }
    );
  }
}
