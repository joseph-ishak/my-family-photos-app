import type { NextRequest } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";

const region = process.env.COGNITO_REGION!;
const userPoolId = process.env.COGNITO_USER_POOL_ID!;
const clientId = process.env.COGNITO_APP_CLIENT_ID!;

const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));

export type VerifiedUser = {
  sub: string;
  email?: string;
  nickname?: string;
  preferred_username?: string;
  [key: string]: unknown;
};

export async function getVerifiedUser(
  req: NextRequest
): Promise<VerifiedUser | null> {
  const token = req.cookies.get("idToken")?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: clientId,
    });

    if (!payload.sub || typeof payload.sub !== "string") return null;
    return payload as unknown as VerifiedUser;
  } catch {
    return null;
  }
}
