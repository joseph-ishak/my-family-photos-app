// src/lib/cursor.ts
//
// Opaque, tamper-proof pagination cursors using AES-256-GCM.
//
// Before this module existed, cursors were plain base64-encoded JSON:
//
//   eyJQSyI6IkVWRU5UI ... (base64-decode) →  {"PK":"EVENT#Summer2025","SK":"MEDIA#...","GSI1PK":"PHOTO",...}
//
// That exposed our entire DynamoDB key structure to every client. Any schema
// rename would silently break cursors held in clients' browser memory.
//
// Now cursors are AES-256-GCM ciphertext. The client sees an opaque token:
//
//   r7k9mXz2...  (base64url, no decodable structure)
//
// Properties:
//   - Confidential  — schema keys are not visible to the client
//   - Tamper-proof  — GCM auth tag detects any bit-flip or forgery
//   - Stateless     — no server-side cursor storage needed
//   - Ephemeral     — a cursor encrypted under a rotated CURSOR_SECRET becomes
//                     invalid, forcing a fresh first-page fetch (graceful UX)
//
// Required env var:
//   CURSOR_SECRET   — any non-empty string; rotatable; not a raw key (SHA-256
//                     derived internally so any length input works)

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;   // 96-bit IV — standard for GCM
const TAG_LENGTH = 16;  // 128-bit auth tag — GCM default

/**
 * Derives a 32-byte AES key from CURSOR_SECRET.
 * Throws in production if the env var is not set.
 * Falls back to a deterministic dev key in non-production environments.
 */
function getKey(): Buffer {
  const secret = process.env.CURSOR_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "CURSOR_SECRET env var must be set in production. " +
          "Set it to any non-empty secret string in your deployment config."
      );
    }
    // Non-production fallback — cursors work but are NOT secure.
    // This lets `npm run dev` and tests work without extra setup.
    return createHash("sha256")
      .update("dev-cursor-secret-do-not-use-in-production")
      .digest();
  }

  return createHash("sha256").update(secret).digest();
}

/**
 * Encrypts a DynamoDB LastEvaluatedKey into an opaque pagination cursor.
 *
 * Returns null if lastEvaluatedKey is null/undefined (no more pages).
 *
 * Token layout (before base64url encoding):
 *   [ iv: 12 bytes ][ authTag: 16 bytes ][ ciphertext: N bytes ]
 */
export function encodeCursor(
  lastEvaluatedKey: Record<string, unknown> | null | undefined
): string | null {
  if (!lastEvaluatedKey) return null;

  try {
    const key = getKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    const plaintext = JSON.stringify(lastEvaluatedKey);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return Buffer.concat([iv, authTag, ciphertext]).toString("base64url");
  } catch {
    return null;
  }
}

/**
 * Decrypts a cursor token back to a DynamoDB ExclusiveStartKey.
 *
 * Returns undefined if the token is:
 *   - absent / empty
 *   - too short to be valid
 *   - encrypted under a different key (e.g. after CURSOR_SECRET rotation)
 *   - tampered with (GCM auth tag mismatch)
 *   - malformed JSON
 *
 * All of the above are treated identically: start from page 1.
 * This keeps the UX graceful — a stale bookmark just resets to the top.
 */
export function decodeCursor(
  cursor: string | null | undefined
): Record<string, unknown> | undefined {
  if (!cursor) return undefined;

  try {
    const key = getKey();
    const buf = Buffer.from(cursor, "base64url");

    // Minimum viable token: iv + authTag + at least 1 byte of ciphertext
    if (buf.length < IV_LENGTH + TAG_LENGTH + 1) return undefined;

    const iv = buf.subarray(0, IV_LENGTH);
    const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return JSON.parse(decrypted.toString("utf8"));
  } catch {
    // Any error (wrong key, tampered payload, bad JSON) → treat as no cursor
    return undefined;
  }
}
