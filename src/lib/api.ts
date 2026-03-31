import { NextResponse } from "next/server";

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
