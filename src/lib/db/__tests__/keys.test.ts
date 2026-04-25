/**
 * Unit tests for `src/lib/db/keys.ts`.
 *
 * Verifies that `Keys` produces the correct DynamoDB key strings, prefixes,
 * and partition constants used throughout the application.
 */
import { describe, it, expect } from "vitest";
import { Keys } from "@/lib/db/keys";

describe("Keys", () => {
  describe("key builders", () => {
    it("builds EVENT# prefixed key", () => {
      expect(Keys.event("Almont 2025")).toBe("EVENT#Almont 2025");
    });

    it("builds USER# prefixed key", () => {
      expect(Keys.user("abc-123")).toBe("USER#abc-123");
    });

    it("builds GROUP# prefixed key", () => {
      expect(Keys.group("group-uuid")).toBe("GROUP#group-uuid");
    });

    it("builds MEDIA# key with takenAt and mediaId", () => {
      expect(Keys.media("2026-03-24T03:31:09.744Z", "media-uuid")).toBe(
        "MEDIA#2026-03-24T03:31:09.744Z#media-uuid"
      );
    });

    it("builds MEMBER# prefixed key", () => {
      expect(Keys.member("user-sub")).toBe("MEMBER#user-sub");
    });

    it("builds SHARE#GROUP# key", () => {
      expect(Keys.shareGroup("group-uuid")).toBe("SHARE#GROUP#group-uuid");
    });
  });

  describe("prefixes", () => {
    it("provides correct begins_with prefixes", () => {
      expect(Keys.prefixes.event).toBe("EVENT#");
      expect(Keys.prefixes.user).toBe("USER#");
      expect(Keys.prefixes.group).toBe("GROUP#");
      expect(Keys.prefixes.media).toBe("MEDIA#");
    });
  });

  describe("partitions", () => {
    it("provides correct partition key values", () => {
      expect(Keys.partitions.events).toBe("EVENT");
      expect(Keys.partitions.photos).toBe("PHOTO");
    });
  });
});
