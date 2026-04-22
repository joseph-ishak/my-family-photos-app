/**
 * Sentry PII scrubber — applied via the beforeSend hook in all three Sentry
 * config files (server, client, edge).
 *
 * What it strips:
 *  - Cookie and Authorization headers (contain JWT tokens)
 *  - Sensitive keys from request bodies (password, newPassword, token, etc.)
 *  - Query params that commonly carry tokens (access_token, code, state)
 *  - User email from the Sentry user context (we set user.id only)
 *
 * Returning null from beforeSend drops the event entirely; we never do that
 * here — we only redact fields so events still appear in Sentry.
 */

import type { ErrorEvent } from "@sentry/core";

/** Request body keys that must never reach Sentry. */
const SENSITIVE_BODY_KEYS = new Set([
  "password",
  "newPassword",
  "Password",
  "NewPassword",
  "token",
  "accessToken",
  "refreshToken",
  "idToken",
  "secret",
  "code",
  "confirmationCode",
  "ConfirmationCode",
]);

/** URL query params that may carry auth tokens. */
const SENSITIVE_PARAMS = new Set([
  "access_token",
  "id_token",
  "refresh_token",
  "code",
  "state",
  "session",
]);

/** Request headers that may carry auth credentials. */
const SENSITIVE_HEADERS = new Set([
  "cookie",
  "Cookie",
  "authorization",
  "Authorization",
  "x-api-key",
  "X-Api-Key",
]);

function scrubHeaders(
  headers: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!headers) return headers;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_HEADERS.has(k) ? "[Filtered]" : v;
  }
  return out;
}

function scrubBody(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    out[k] = SENSITIVE_BODY_KEYS.has(k) ? "[Filtered]" : v;
  }
  return out;
}

function scrubUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    for (const param of SENSITIVE_PARAMS) {
      if (parsed.searchParams.has(param)) {
        parsed.searchParams.set(param, "[Filtered]");
      }
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  // Scrub request
  if (event.request) {
    event.request = {
      ...event.request,
      headers: scrubHeaders(event.request.headers as Record<string, string>),
      cookies: {},
      url: scrubUrl(event.request.url),
      data: scrubBody(event.request.data),
    };
  }

  // Scrub user — keep id for deduplication, drop email and username
  if (event.user) {
    const { id } = event.user;
    event.user = id ? { id } : {};
  }

  return event;
}
