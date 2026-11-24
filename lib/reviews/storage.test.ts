import { beforeEach, describe, expect, it } from "vitest";
import type { LearningMap } from "@/types/map";
import {
  submitReviewIdempotent,
  loadAllReviews,
  deleteReviewsForMap,
  deleteReviewForNode,
  migrateGuestReviews,
} from "./storage";
import { getDueReviews } from "./queue";

function createMockStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() { return store.size; },
  };
}

const sampleMap: LearningMap = {
  id: "map-algo",
  title: "Algorithms",
  description: "Core Algorithms",
  category: "Computer Science",
  accent: "#3b82f6",
  bibbles: [
    {
      id: "node-dp",
      title: "Dynamic Programming",
      status: "completed",
      progress: 100,
      position: { x: 0, y: 0 },
    },
    {
      id: "node-graphs",
      title: "Graphs",
      status: "learning",
      progress: 40,
      position: { x: 100, y: 0 },
    },
  ],
  edges: [],
};

describe("spaced-review storage & due queue", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createMockStorage();
  });

  it("submits reviews idempotently and rejects duplicate idempotency keys from advancing intervals", () => {
    const input = {
      mapId: "map-algo",
      nodeId: "node-dp",
      rating: "good" as const,
      idempotencyKey: "idem-abc-123",
      reviewedAt: new Date("2026-11-23T10:00:00Z"),
    };

    // First submission
    const res1 = submitReviewIdempotent(storage, "user-1", input);
    expect(res1.isDuplicate).toBe(false);
    expect(res1.record.intervalDays).toBe(1);
    expect(res1.record.repetitions).toBe(1);
    expect(res1.record.history).toHaveLength(1);

    // Duplicate submission with same idempotency key
    const res2 = submitReviewIdempotent(storage, "user-1", input);
    expect(res2.isDuplicate).toBe(true);
    expect(res2.record.intervalDays).toBe(1); // Not advanced!
    expect(res2.record.repetitions).toBe(1);
    expect(res2.record.history).toHaveLength(1);

    // Submission with a NEW idempotency key advances the interval
    const res3 = submitReviewIdempotent(storage, "user-1", {
      ...input,
      idempotencyKey: "idem-def-456",
      reviewedAt: new Date("2026-11-24T10:00:00Z"),
    });
    expect(res3.isDuplicate).toBe(false);
    expect(res3.record.intervalDays).toBe(6); // Advanced to next SM-2 interval
    expect(res3.record.repetitions).toBe(2);
    expect(res3.record.history).toHaveLength(2);
  });

  it("isolates reviews across different user accounts and guests", () => {
    submitReviewIdempotent(storage, "user-alpha", {
      mapId: "map-algo",
      nodeId: "node-dp",
      rating: "good",
      idempotencyKey: "key-alpha",
    });

    submitReviewIdempotent(storage, "user-beta", {
      mapId: "map-algo",
      nodeId: "node-dp",
      rating: "easy",
      idempotencyKey: "key-beta",
    });

    submitReviewIdempotent(storage, null, {
      mapId: "map-algo",
      nodeId: "node-dp",
      rating: "again",
      idempotencyKey: "key-guest",
    });

    const alphaReviews = loadAllReviews(storage, "user-alpha");
    const betaReviews = loadAllReviews(storage, "user-beta");
    const guestReviews = loadAllReviews(storage, null);

    expect(alphaReviews).toHaveLength(1);
    expect(alphaReviews[0].lastRating).toBe("good");

    expect(betaReviews).toHaveLength(1);
    expect(betaReviews[0].lastRating).toBe("easy");

    expect(guestReviews).toHaveLength(1);
    expect(guestReviews[0].lastRating).toBe("again");
  });

  it("migrates guest reviews to authenticated account on login", () => {
    submitReviewIdempotent(storage, null, {
      mapId: "map-algo",
      nodeId: "node-dp",
      rating: "good",
      idempotencyKey: "guest-idem-1",
    });

    expect(loadAllReviews(storage, null)).toHaveLength(1);
    expect(loadAllReviews(storage, "user-loggedin")).toHaveLength(0);

    const migrated = migrateGuestReviews(storage, "user-loggedin");
    expect(migrated).toBe(1);

    // Guest namespace is now empty
    expect(loadAllReviews(storage, null)).toHaveLength(0);

    // Account namespace has the review record
    const userReviews = loadAllReviews(storage, "user-loggedin");
    expect(userReviews).toHaveLength(1);
    expect(userReviews[0].userId).toBe("user-loggedin");
    expect(userReviews[0].nodeId).toBe("node-dp");
  });

  it("cleans up review records when a map or node is deleted", () => {
    submitReviewIdempotent(storage, "user-1", {
      mapId: "map-algo",
      nodeId: "node-dp",
      rating: "good",
      idempotencyKey: "key-1",
    });
    submitReviewIdempotent(storage, "user-1", {
      mapId: "map-algo",
      nodeId: "node-other",
      rating: "good",
      idempotencyKey: "key-2",
    });

    expect(loadAllReviews(storage, "user-1")).toHaveLength(2);

    // Delete single node
    const deletedNode = deleteReviewForNode(storage, "user-1", "map-algo", "node-other");
    expect(deletedNode).toBe(true);
    expect(loadAllReviews(storage, "user-1")).toHaveLength(1);

    // Delete entire map
    const deletedMapCount = deleteReviewsForMap(storage, "user-1", "map-algo");
    expect(deletedMapCount).toBe(1);
    expect(loadAllReviews(storage, "user-1")).toHaveLength(0);
  });

  it("filters out deleted maps, deleted nodes, and uncompleted nodes from the due queue", () => {
    const past = new Date("2026-11-20T10:00:00Z");
    const now = new Date("2026-11-23T12:00:00Z");

    // Record 1: node-dp (completed in sampleMap) -> SHOULD BE DUE
    submitReviewIdempotent(storage, "user-1", {
      mapId: "map-algo",
      nodeId: "node-dp",
      rating: "good",
      idempotencyKey: "key-dp",
      reviewedAt: past,
    });

    // Record 2: node-graphs (NOT completed in sampleMap, progress: 40) -> SHOULD BE EXCLUDED
    submitReviewIdempotent(storage, "user-1", {
      mapId: "map-algo",
      nodeId: "node-graphs",
      rating: "good",
      idempotencyKey: "key-graphs",
      reviewedAt: past,
    });

    // Record 3: deleted map (not in sampleMaps) -> SHOULD BE EXCLUDED
    submitReviewIdempotent(storage, "user-1", {
      mapId: "map-deleted",
      nodeId: "node-old",
      rating: "good",
      idempotencyKey: "key-old",
      reviewedAt: past,
    });

    const dueResult = getDueReviews(storage, "user-1", [sampleMap], { now });

    expect(dueResult.total).toBe(1);
    expect(dueResult.items).toHaveLength(1);
    expect(dueResult.items[0].nodeId).toBe("node-dp");
    expect(dueResult.items[0].mapId).toBe("map-algo");
    expect(dueResult.items[0].isOverdue).toBe(true);
    expect(dueResult.summary.dueCount).toBe(1);
    expect(dueResult.summary.overdueCount).toBe(1);
    expect(dueResult.summary.totalTrackedNodes).toBe(1);
  });

  it("supports bounded pagination on the due queue", () => {
    const past = new Date("2026-11-20T10:00:00Z");
    const now = new Date("2026-11-23T12:00:00Z");

    const multiNodeMap: LearningMap = {
      ...sampleMap,
      bibbles: Array.from({ length: 10 }, (_, i) => ({
        id: `node-${i}`,
        title: `Node ${i}`,
        status: "completed",
        progress: 100,
        position: { x: i * 10, y: 0 },
      })),
    };

    for (let i = 0; i < 10; i++) {
      submitReviewIdempotent(storage, "user-1", {
        mapId: multiNodeMap.id,
        nodeId: `node-${i}`,
        rating: "good",
        idempotencyKey: `idem-${i}`,
        reviewedAt: new Date(past.getTime() + i * 3600_000),
      });
    }

    const page1 = getDueReviews(storage, "user-1", [multiNodeMap], { now, limit: 3, offset: 0 });
    expect(page1.total).toBe(10);
    expect(page1.items).toHaveLength(3);
    expect(page1.hasMore).toBe(true);

    const page2 = getDueReviews(storage, "user-1", [multiNodeMap], { now, limit: 3, offset: 3 });
    expect(page2.items).toHaveLength(3);
    expect(page2.items[0].nodeId).toBe("node-3");

    const page4 = getDueReviews(storage, "user-1", [multiNodeMap], { now, limit: 3, offset: 9 });
    expect(page4.items).toHaveLength(1);
    expect(page4.hasMore).toBe(false);
  });
});
