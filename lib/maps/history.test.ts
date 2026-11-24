import { afterEach, vi, beforeEach, describe, expect, it } from "vitest";
import type { LearningMap } from "@/types/map";
import {
  computeMapDiff,
  createSnapshotFromMap,
  getLocalHistoryStorageKey,
  loadLocalSnapshots,
  pruneSnapshots,
  recordMapRevision,
  restoreMapRevision,
  saveLocalSnapshots,
} from "./history";

class MockStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  key(index: number) {
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
}

const mockStorage = new MockStorage();
(globalThis as unknown as { localStorage: Storage }).localStorage = mockStorage;

const baseMap: LearningMap = {
  id: "map-history-test",
  title: "Systems Architecture",
  description: "Distributed systems fundamentals.",
  category: "Computer Science",
  accent: "lavender",
  bibbles: [
    {
      id: "node-1",
      title: "Consensus Algorithms",
      description: "Raft, Paxos",
      status: "completed",
      progress: 100,
      position: { x: 50, y: 100 },
      resources: [],
      notes: "Quorum basics",
    },
    {
      id: "node-2",
      title: "Vector Clocks",
      description: "Lamport timestamps and causality",
      status: "learning",
      progress: 40,
      position: { x: 250, y: 100 },
      resources: [],
      notes: "",
    },
  ],
  edges: [{ id: "edge-1", source: "node-1", target: "node-2" }],
};

describe("Map Revision History Engine", () => {
  beforeEach(() => {
    mockStorage.clear();
    vi.stubGlobal("window", { localStorage:mockStorage, dispatchEvent:vi.fn() });
    vi.stubGlobal("navigator", { locks:{request:async (_name:string,fn:()=>unknown)=>fn()} });
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
  });

  afterEach(() => {vi.unstubAllGlobals();vi.unstubAllEnvs();});

  describe("createSnapshotFromMap", () => {
    it("creates an isolated immutable snapshot with correct metadata", () => {
      const snapshot = createSnapshotFromMap(baseMap, 1, "save");

      expect(snapshot.id).toMatch(/^snap_map-history-test_r1_/);
      expect(snapshot.mapId).toBe("map-history-test");
      expect(snapshot.revision).toBe(1);
      expect(snapshot.title).toBe("Systems Architecture");
      expect(snapshot.nodeCount).toBe(2);
      expect(snapshot.edgeCount).toBe(1);
      expect(snapshot.trigger).toBe("save");
      expect(snapshot.snapshot).toEqual(baseMap);

      // Verify deep clone isolation: modifying baseMap does not mutate snapshot
      baseMap.title = "Modified Title";
      expect(snapshot.snapshot.title).toBe("Systems Architecture");
      baseMap.title = "Systems Architecture";
    });
  });

  describe("computeMapDiff", () => {
    it("accurately detects additions, removals, modifications, and structural edits", () => {
      const updatedMap: LearningMap = {
        ...baseMap,
        title: "Advanced Distributed Systems",
        bibbles: [
          // node-1 modified progress
          { ...baseMap.bibbles[0], progress: 50, status: "learning" },
          // node-3 added
          {
            id: "node-3",
            title: "CRDTs",
            status: "not-started",
            progress: 0,
            position: { x: 450, y: 100 },
          },
          // node-2 removed
        ],
        edges: [{ id: "edge-2", source: "node-1", target: "node-3" }],
      };

      const diff = computeMapDiff(baseMap, updatedMap);

      expect(diff.nodesAdded).toBe(1); // node-3
      expect(diff.nodesRemoved).toBe(1); // node-2
      expect(diff.nodesModified).toBe(1); // node-1
      expect(diff.edgesAdded).toBe(1); // edge-2
      expect(diff.edgesRemoved).toBe(1); // edge-1
      expect(diff.titleChanged).toBe(true);
      expect(diff.descriptionChanged).toBe(false);
    });
  });

  describe("pruneSnapshots", () => {
    it("retains all snapshots when count is within the retention limit", () => {
      const list = [
        createSnapshotFromMap(baseMap, 1, "save", "s1"),
        createSnapshotFromMap(baseMap, 2, "save", "s2"),
      ];
      expect(pruneSnapshots(list, 5)).toHaveLength(2);
    });

    it("bounds revision history to configured limit and prunes oldest entries", () => {
      const list = Array.from({ length: 25 }, (_, i) =>
        createSnapshotFromMap(baseMap, i + 1, "save", `snap_${i + 1}`)
      );

      const pruned = pruneSnapshots(list, 20);
      expect(pruned).toHaveLength(20);
      // Newest revision should be preserved at index 0
      expect(pruned[0].revision).toBe(25);
      // Oldest retained should be revision 6 (1 through 5 pruned)
      expect(pruned[19].revision).toBe(6);
    });
  });

  describe("Local / Guest Storage Integration", () => {
    it("round-trips snapshots through local storage and filters invalid entries", () => {
      const s1 = createSnapshotFromMap(baseMap, 1, "initial");
      const s2 = createSnapshotFromMap(baseMap, 2, "save");

      saveLocalSnapshots(baseMap.id, [s2, s1]);
      const loaded = loadLocalSnapshots(baseMap.id);

      expect(loaded).toHaveLength(2);
      expect(loaded[0].id).toBe(s2.id);
      expect(loaded[1].id).toBe(s1.id);
    });

    it("handles corrupted local storage data gracefully", () => {
      const key = getLocalHistoryStorageKey(baseMap.id);
      mockStorage.setItem(key, "invalid-json{{[");
      expect(loadLocalSnapshots(baseMap.id)).toEqual([]);

      mockStorage.setItem(key, JSON.stringify([{ id: "bad", missingFields: true }]));
      expect(loadLocalSnapshots(baseMap.id)).toEqual([]);
    });
  });

  describe("restoreMapRevision", () => {
    it("rejects restoration when current revision does not match expected revision (OCC conflict guard)", async () => {
      const s1 = createSnapshotFromMap(baseMap, 1, "initial");
      saveLocalSnapshots(baseMap.id, [s1]);

      const result = await restoreMapRevision({
        mapId: baseMap.id,
        snapshotId: s1.id,
        currentRevision: 3, // Current has advanced to 3
        expectedRevision: 1, // User opened dialog when revision was 1
      });

      expect(result.success).toBe(false);
      expect(result.conflictError).toBe(true);
      expect(result.errorMessage).toContain("Concurrency conflict");
      expect(result.restoredMap).toBeNull();
    });

    it("restores snapshot as a fresh revision with audited restore trigger", async () => {
      const v1Map = { ...baseMap, title: "Initial Version" };
      const v2Map = { ...baseMap, title: "Second Version" };

      // Record v1
      const s1 = await recordMapRevision(v1Map, 1, "initial");
      // Record v2
      await recordMapRevision(v2Map, 2, "save");

      mockStorage.setItem("bibble-maps", JSON.stringify([{...v2Map,version:2}]));
      // Now restore v1 while on v2
      const result = await restoreMapRevision({
        mapId: baseMap.id,
        snapshotId: s1.id,
        currentRevision: 2,
        expectedRevision: 2,
      });

      expect(result.success).toBe(true);
      expect(result.newRevision).toBe(3);
      expect(result.restoredMap?.title).toBe("Initial Version");

      // Verify that the restore created a new snapshot in history with trigger 'restore'
      const history = loadLocalSnapshots(baseMap.id);
      expect(history[0].revision).toBe(3);
      expect(history[0].trigger).toBe("restore");
      expect(history[0].title).toBe("Initial Version");
    });

    it("compares against committed browser state even when dialog tokens match each other", async () => {
      const snapshot=await recordMapRevision(baseMap,1,"initial");
      mockStorage.setItem("bibble-maps",JSON.stringify([{...baseMap,version:3,title:"Other tab"}]));
      const result=await restoreMapRevision({mapId:baseMap.id,snapshotId:snapshot.id,currentRevision:2,expectedRevision:2});
      expect(result.success).toBe(false);expect(result.conflictError).toBe(true);
      expect(JSON.parse(mockStorage.getItem("bibble-maps")!)[0].title).toBe("Other tab");
      expect(loadLocalSnapshots(baseMap.id)).toHaveLength(1);
    });

    it("returns error when target snapshot ID does not exist", async () => {
      const result = await restoreMapRevision({
        mapId: baseMap.id,
        snapshotId: "non-existent-snapshot-id",
        currentRevision: 1,
        expectedRevision: 1,
      });

      expect(result.success).toBe(false);
      expect(result.conflictError).toBe(false);
      expect(result.errorMessage).toContain("Snapshot not found");
    });
  });
});
