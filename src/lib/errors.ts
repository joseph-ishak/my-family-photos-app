export const ErrorCode = {
  UNAUTHORIZED:    "UNAUTHORIZED",
  FORBIDDEN:       "FORBIDDEN",
  NOT_FOUND:       "NOT_FOUND",
  BAD_REQUEST:     "BAD_REQUEST",
  CONFLICT:        "CONFLICT",
  UNPROCESSABLE:   "UNPROCESSABLE",
  DYNAMO_THROTTLE: "DYNAMO_THROTTLE",
  DYNAMO_ERROR:    "DYNAMO_ERROR",
  S3_NOT_FOUND:    "S3_NOT_FOUND",
  S3_ERROR:        "S3_ERROR",
  CONFIG_ERROR:    "CONFIG_ERROR",
  INTERNAL:        "INTERNAL",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Throw this from any route handler to produce a specific HTTP error response.
 * `handleRouteError` in lib/api.ts catches it and maps it directly to JSON.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(message: string, code: ErrorCode, status: number) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Throw this when a DynamoDB conditional write fails because the resource
 * already exists — e.g. "already a member" or "already shared to this group".
 * Maps to HTTP 409.
 */
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, ErrorCode.CONFLICT, 409);
    this.name = "ConflictError";
  }
}
