import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { usePhotosFeed } from "@/hooks/usePhotoFeed";
import { encodeCursor } from "@/lib/cursor";

// GSI cursor — what the global /api/photos query returns (contains GSI index keys)
const GSI_CURSOR = encodeCursor({
  GSI1PK: "PHOTO",
  SK: "MEDIA#2026-03-24T03:31:09.744Z#stale-id",
  GSI1SK: "MEDIA#2026-03-24T03:31:09.744Z#stale-id",
  PK: "EVENT#Almont 2025",
})!;

// PK cursor — what the event-scoped query correctly returns (table PK only)
const PK_CURSOR = encodeCursor({
  PK: "EVENT#Almont 2025",
  SK: "MEDIA#2026-03-20T00:00:00.000Z#correct-id",
})!;

function makePhoto(id: string) {
  return {
    key: `uploads/photos/${id}.jpg`,
    s3Key: `uploads/photos/${id}.jpg`,
    url: `https://cdn.example.com/${id}.jpg`,
    pk: "EVENT#Almont 2025",
    sk: `MEDIA#2026-03-24T03:00:00.000Z#${id}`,
    eventId: "Almont 2025",
    takenAt: "2026-03-24T03:00:00.000Z",
    mediaType: "photo" as const,
  };
}

// Minimal IntersectionObserver stub — observe/disconnect are no-ops
class MockIntersectionObserver {
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Helper: render the hook and immediately attach a DOM element to loaderRef
 * so the useInfiniteScroll effect doesn't spin in a retry loop.
 */
function renderFeedHook(initialEventFilter: string) {
  const loaderEl = document.createElement("div");
  const hookResult = renderHook(() =>
    usePhotosFeed({ initialEventFilter })
  );
  // Attach AFTER render so the effect's retry timer fires and finds the element
  act(() => {
    hookResult.result.current.loaderRef.current = loaderEl;
  });
  return hookResult;
}

describe("usePhotosFeed — pagination bug regression", () => {
  it("event-scoped first page uses PK cursor, not GSI cursor", async () => {
    /**
     * The bug: refreshEvents completes before the first global fetch, causing
     * serverEventId to change and the reset effect to fire while the global
     * fetch is still in-flight. The global fetch later completes and overwrites
     * nextCursor with a GSI cursor. When page 2 is requested with eventId, the
     * GSI cursor is sent to an event-scoped DynamoDB query → 500.
     *
     * After the fix (generationRef), the stale global fetch result is discarded.
     * This test verifies that page 2 uses the PK cursor from the event fetch.
     */
    const fetchCalls: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        fetchCalls.push(url);
        const u = new URL(url, "http://localhost");
        const eventId = u.searchParams.get("eventId");
        const cursor = u.searchParams.get("cursor");

        if (url.includes("/api/events")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                summaries: [{ eventId: "Almont 2025" }],
                events: [],
              }),
          });
        }

        // Global fetch (no eventId, no cursor) → returns stale GSI cursor
        if (!eventId && !cursor) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                photos: Array.from({ length: 20 }, (_, i) =>
                  makePhoto(`global-${i}`)
                ),
                nextCursor: GSI_CURSOR,
              }),
          });
        }

        // Event-scoped first page → returns correct PK cursor
        if (eventId === "Almont 2025" && !cursor) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                photos: Array.from({ length: 20 }, (_, i) =>
                  makePhoto(`event-page1-${i}`)
                ),
                nextCursor: PK_CURSOR,
              }),
          });
        }

        // Event-scoped page 2 (has cursor + eventId)
        if (eventId === "Almont 2025" && cursor) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                photos: Array.from({ length: 5 }, (_, i) =>
                  makePhoto(`event-page2-${i}`)
                ),
                nextCursor: null,
              }),
          });
        }

        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ photos: [] }),
          text: () => Promise.resolve(`unexpected: ${url}`),
        });
      })
    );

    const { result } = renderFeedHook("Almont 2025");

    // Wait for the event-scoped photos to appear
    await waitFor(
      () => {
        expect(result.current.filteredPhotos.length).toBeGreaterThan(0);
      },
      { timeout: 4000 }
    );

    // Trigger page 2 via loadMore (exposed after the fix)
    await act(async () => {
      result.current.loadMore();
    });

    await waitFor(
      () => {
        const page2Call = fetchCalls.find((url) => {
          const u = new URL(url, "http://localhost");
          return (
            url.includes("/api/photos") &&
            u.searchParams.has("cursor") &&
            u.searchParams.has("eventId")
          );
        });

        expect(page2Call).toBeDefined();

        if (page2Call) {
          const u = new URL(page2Call, "http://localhost");
          const cursorStr = u.searchParams.get("cursor")!;
          // Cursors are now opaque (AES-256-GCM encrypted) — we can't inspect
          // their internals directly. Instead, assert that the hook used the
          // correct cursor (PK_CURSOR from the event fetch) and not the stale
          // one (GSI_CURSOR from the abandoned global fetch).
          expect(cursorStr).toBe(PK_CURSOR);
          expect(cursorStr).not.toBe(GSI_CURSOR);
        }
      },
      { timeout: 4000 }
    );
  });

  it("stale global fetch result is discarded after serverEventId changes", async () => {
    /**
     * Verifies the generationRef fix: a global fetch that completes AFTER
     * the reset effect cannot overwrite nextCursor with the stale GSI cursor.
     */
    let resolveGlobalFetch!: (v: unknown) => void;
    const globalFetchHeld = new Promise((res) => {
      resolveGlobalFetch = res;
    });

    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const u = new URL(url, "http://localhost");
        const eventId = u.searchParams.get("eventId");
        const cursor = u.searchParams.get("cursor");

        if (url.includes("/api/events")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                summaries: [{ eventId: "Almont 2025" }],
                events: [],
              }),
          });
        }

        // Global fetch — held until explicitly released
        if (!eventId && !cursor) {
          return globalFetchHeld.then(() => ({
            ok: true,
            json: () =>
              Promise.resolve({ photos: [], nextCursor: GSI_CURSOR }),
          }));
        }

        // Event-scoped fetch → correct PK cursor
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              photos: Array.from({ length: 5 }, (_, i) => makePhoto(`ev-${i}`)),
              nextCursor: PK_CURSOR,
            }),
        });
      })
    );

    const { result } = renderFeedHook("Almont 2025");

    // Wait for the event-scoped fetch to settle (global is still held)
    await waitFor(
      () => {
        expect(result.current.filteredPhotos.length).toBeGreaterThan(0);
      },
      { timeout: 4000 }
    );

    // Release the stale global fetch — its result should be discarded
    await act(async () => {
      resolveGlobalFetch(undefined);
    });

    // Trigger page 2
    await act(async () => {
      result.current.loadMore();
    });

    const fetchMock = vi.mocked(fetch);
    const allCalls = fetchMock.mock.calls.map(([url]) => url as string);

    // There must be NO call that pairs the GSI cursor with an eventId
    const badCall = allCalls.find((url) => {
      const u = new URL(url, "http://localhost");
      return (
        url.includes("/api/photos") &&
        u.searchParams.get("cursor") === GSI_CURSOR &&
        u.searchParams.has("eventId")
      );
    });

    expect(badCall).toBeUndefined();
  });
});
