/**
 * Returns a trimmed string, or null if the value is empty, whitespace-only,
 * or not a string.
 */
export function asNonEmptyString(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : null;
}

/**
 * Splits an array into chunks of at most `size` elements.
 */
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Normalizes an event ID. Returns null for empty, whitespace-only, or
 * "default" values (case-insensitive).
 */
export function normalizeEventId(raw: unknown): string | null {
  const v = asNonEmptyString(raw);
  if (!v || v.toLowerCase() === "default") return null;
  return v;
}

export type GroupRole = "owner" | "admin" | "member";

/**
 * Normalizes a group role string. Returns "member" for any unrecognized value.
 */
export function normalizeRole(raw: unknown): GroupRole {
  const v = asNonEmptyString(raw);
  if (v === "owner" || v === "admin" || v === "member") return v;
  return "member";
}
