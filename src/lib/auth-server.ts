/**
 * Server-side JWT verification for Cognito-issued tokens.
 *
 * The JWKS is fetched once at module load time and cached in memory by `jose`.
 * Subsequent requests validate signatures locally without any network round-trip
 * to Cognito (until the key set is rotated, which triggers a background refresh).
 */
import type { NextRequest } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";

const region = process.env.COGNITO_REGION!;
const userPoolId = process.env.COGNITO_USER_POOL_ID!;
const clientId = process.env.COGNITO_APP_CLIENT_ID!;

const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));

/**
 * The decoded Cognito JWT payload for the currently authenticated user.
 * `sub` is the stable, unique Cognito user ID used as the primary user
 * identifier throughout the application.
 */
export type VerifiedUser = {
  /** Cognito user ID — used as the primary user key in DynamoDB. */
  sub: string;
  email?: string;
  nickname?: string;
  preferred_username?: string;
  [key: string]: unknown;
};

/**
 * Reads the `idToken` cookie from the request, verifies its signature and
 * claims against the Cognito JWKS, and returns the decoded payload.
 *
 * Returns `null` if the cookie is absent, the token is expired, or the
 * signature check fails — callers should respond with HTTP 401 in that case.
 */
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
