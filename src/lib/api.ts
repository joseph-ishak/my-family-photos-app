import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { AppError, ErrorCode } from "@/lib/errors";

/**
 * Returns a JSON error response with the given message and status code.
 */
export function apiError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Returns a JSON success response.
 */
export function apiOk<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

/**
 * Returns the DYNAMO_TABLE_NAME env var, throwing if it is not set.
 * Use at the top of route handlers so misconfiguration fails loudly.
 */
export function requireTable(): string {
  const table = process.env.DYNAMO_TABLE_NAME;
  if (!table) throw new Error("DYNAMO_TABLE_NAME env var is not set");
  return table;
}

/**
 * Returns the S3_BUCKET_NAME env var, throwing if it is not set.
 */
export function requireBucket(): string {
  const bucket = process.env.S3_BUCKET_NAME;
  if (!bucket) throw new Error("S3_BUCKET_NAME env var is not set");
  return bucket;
}

/**
 * Central catch handler. Classifies the error, emits a structured JSON log
 * line parseable by CloudWatch Metric Filters, and returns a consistent
 * { error, code } response.
 *
 * CloudWatch Metric Filter pattern: { $.level = "ERROR" && $.status >= 500 }
 * Dimensions available: route, code — enables per-route alarms.
 *
 * @example
 *   } catch (err) { return handleRouteError("POST /api/media/commit", err); }
 */
export function handleRouteError(route: string, err: unknown): NextResponse {
  if (err instanceof AppError) {
    log(route, err.status, err.code, err.message);
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: err.status }
    );
  }

  // Use err.name (stable AWS SDK v3 contract), not string matching on err.message
  if (isAwsError(err, "ConditionalCheckFailedException")) {
    const msg = "Resource already exists or condition not met";
    log(route, 409, ErrorCode.CONFLICT, msg);
    return NextResponse.json(
      { error: msg, code: ErrorCode.CONFLICT },
      { status: 409 }
    );
  }

  if (
    isAwsError(err, "ProvisionedThroughputExceededException") ||
    isAwsError(err, "ThrottlingException") ||
    isAwsError(err, "RequestLimitExceeded")
  ) {
    const msg = "Service temporarily unavailable, please retry";
    log(route, 503, ErrorCode.DYNAMO_THROTTLE, msg);
    return NextResponse.json(
      { error: msg, code: ErrorCode.DYNAMO_THROTTLE },
      { status: 503 }
    );
  }

  // Unexpected error — report to Sentry before responding
  Sentry.captureException(err, { extra: { route } });

  const message = err instanceof Error ? err.message : "Internal server error";
  log(route, 500, ErrorCode.INTERNAL, message);
  return NextResponse.json(
    { error: "Internal server error", code: ErrorCode.INTERNAL },
    { status: 500 }
  );
}

/**
 * Wraps an unprotected route handler in a try-catch that calls handleRouteError.
 *
 * @example
 *   export const POST = withErrorHandler("POST /api/upload-url", async (req) => {
 *     // existing handler body unchanged
 *   });
 */
export function withErrorHandler<Ctx = unknown>(
  route: string,
  handler: (req: NextRequest, ctx: Ctx) => Promise<NextResponse>,
): (req: NextRequest, ctx: Ctx) => Promise<NextResponse> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      return handleRouteError(route, err);
    }
  };
}

function log(route: string, status: number, code: string, message: string): void {
  // Single-line JSON — CloudWatch Metric Filters can extract $.status, $.code, $.route
  console.error(JSON.stringify({ level: "ERROR", route, status, code, message }));
}

function isAwsError(err: unknown, name: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: string }).name === name
  );
}
