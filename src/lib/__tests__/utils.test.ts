import { describe, it, expect } from "vitest";
import {
  asNonEmptyString,
  chunk,
  normalizeEventId,
  normalizeRole,
} from "@/lib/utils";

describe("asNonEmptyString", () => {
  it("returns null for empty string", () => {
    expect(asNonEmptyString("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(asNonEmptyString("   ")).toBeNull();
  });

  it("returns null for non-string values", () => {
    expect(asNonEmptyString(null)).toBeNull();
    expect(asNonEmptyString(undefined)).toBeNull();
    expect(asNonEmptyString(0)).toBeNull();
    expect(asNonEmptyString(false)).toBeNull();
    expect(asNonEmptyString({})).toBeNull();
  });

  it("returns trimmed string for valid input", () => {
    expect(asNonEmptyString("hello")).toBe("hello");
    expect(asNonEmptyString("  hello  ")).toBe("hello");
    expect(asNonEmptyString("  a  ")).toBe("a");
  });
});

describe("chunk", () => {
  it("splits array into chunks of given size", () => {
    expect(chunk([1, 2, 3, 4, 5, 6], 2)).toEqual([[1, 2], [3, 4], [5, 6]]);
  });

  it("last chunk is smaller when array length is not divisible", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("handles array shorter than chunk size", () => {
    expect(chunk([1, 2], 10)).toEqual([[1, 2]]);
  });

  it("handles empty array", () => {
    expect(chunk([], 5)).toEqual([]);
  });

  it("handles chunk size of 1", () => {
    expect(chunk([1, 2, 3], 1)).toEqual([[1], [2], [3]]);
  });
});

describe("normalizeEventId", () => {
  it("returns null for empty string", () => {
    expect(normalizeEventId("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(normalizeEventId("   ")).toBeNull();
  });

  it('returns null for "default" (case-insensitive)', () => {
    expect(normalizeEventId("default")).toBeNull();
    expect(normalizeEventId("DEFAULT")).toBeNull();
    expect(normalizeEventId("Default")).toBeNull();
  });

  it("returns trimmed value for valid event id", () => {
    expect(normalizeEventId("Almont 2025")).toBe("Almont 2025");
    expect(normalizeEventId("  Summer Trip  ")).toBe("Summer Trip");
  });

  it("returns null for non-string", () => {
    expect(normalizeEventId(null)).toBeNull();
    expect(normalizeEventId(undefined)).toBeNull();
  });
});

describe("normalizeRole", () => {
  it('returns "owner" for owner', () => {
    expect(normalizeRole("owner")).toBe("owner");
  });

  it('returns "admin" for admin', () => {
    expect(normalizeRole("admin")).toBe("admin");
  });

  it('returns "member" for member', () => {
    expect(normalizeRole("member")).toBe("member");
  });

  it('defaults to "member" for unknown values', () => {
    expect(normalizeRole("superuser")).toBe("member");
    expect(normalizeRole("")).toBe("member");
    expect(normalizeRole(null)).toBe("member");
    expect(normalizeRole(undefined)).toBe("member");
  });
});
