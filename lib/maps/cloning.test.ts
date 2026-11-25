import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cloneLearningMap, forkMap, generateUniqueId } from "./cloning";
import type { LearningMap } from "@/types/map";

const sampleTestMap: LearningMap = {
  id: "sample-roadmap-1",
  title: "Computer Systems Roadmap",
  description: "From logic gates to operating systems.",
  category: "Computer Science",
  accent: "blue",
  version: 4,
  bibbles: [
    {
      id: "b-gates",
      title: "Logic Gates",
      description: "Boolean algebra and transistors.",
      status: "completed",
      progress: 100,
      position: { x: 100, y: 150 },
      resources: [{ id: "r-1", label: "Guide", url: "https://example.com/gates" }],
      notes: "Completed foundational reading.",
      readinessState: "completed",
    },
    {
      id: "b-alu",
      title: "ALU & Registers",
      description: "Arithmetic logic and state.",
      status: "learning",
      progress: 50,
      position: { x: 300, y: 150 },
      resources: [],
      notes: "Practicing adder circuits.",
      readinessState: "ready",
    },
    {
      id: "b-cpu",
      title: "CPU Datapath",
      description: "Instruction cycle and pipelining.",
      status: "not-started",
      progress: 0,
      position: { x: 500, y: 150 },
      resources: [],
      notes: "",
      readinessState: "locked",
    },
  ],
  edges: [
    { id: "e-gates-alu", source: "b-gates", target: "b-alu" },
    { id: "e-alu-cpu", source: "b-alu", target: "b-cpu" },
    { id: "e-dangling", source: "b-alu", target: "non-existent-node" },
  ],
};

const mockSaveMapWithVersion = vi.fn().mockResolvedValue({ status: "saved", storage: "local" });
vi.mock("./persistence", () => ({
  saveMapWithVersion: (...args: unknown[]) => mockSaveMapWithVersion(...args),
}));

const store = new Map<string, string>();

describe("roadmap forking and deep-graph cloning architecture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, val: string) => { store.set(key, val); },
        removeItem: (key: string) => { store.delete(key); },
        clear: () => { store.clear(); },
      },
      dispatchEvent: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("generateUniqueId", () => {
    it("generates distinct prefixed identifiers", () => {
      const id1 = generateUniqueId("map");
      const id2 = generateUniqueId("map");
      expect(id1).toMatch(/^map-\d+-[a-z0-9]+$/);
      expect(id2).toMatch(/^map-\d+-[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });
  });

  describe("cloneLearningMap", () => {
    it("generates distinct map and bibble IDs to avoid multi-tenant primary key collisions", () => {
      const cloned = cloneLearningMap(sampleTestMap);

      expect(cloned.id).not.toBe(sampleTestMap.id);
      expect(cloned.id.startsWith("map-")).toBe(true);

      expect(cloned.bibbles).toHaveLength(3);
      cloned.bibbles.forEach((bibble, index) => {
        expect(bibble.id).not.toBe(sampleTestMap.bibbles[index].id);
        expect(bibble.id.startsWith("bibble-")).toBe(true);
      });
    });

    it("atomically rewrites edge source and target pointers to matching new bibble IDs", () => {
      const cloned = cloneLearningMap(sampleTestMap);

      // Only the 2 valid edges should be translated; the dangling edge pointing to 'non-existent-node' is eliminated
      expect(cloned.edges).toHaveLength(2);

      const [clonedEdge1, clonedEdge2] = cloned.edges;
      const [newGates, newAlu, newCpu] = cloned.bibbles;

      expect(clonedEdge1.source).toBe(newGates.id);
      expect(clonedEdge1.target).toBe(newAlu.id);

      expect(clonedEdge2.source).toBe(newAlu.id);
      expect(clonedEdge2.target).toBe(newCpu.id);

      // Verify all edge endpoints exist in the cloned node collection (referential integrity)
      const clonedNodeIdSet = new Set(cloned.bibbles.map((b) => b.id));
      for (const edge of cloned.edges) {
        expect(clonedNodeIdSet.has(edge.source)).toBe(true);
        expect(clonedNodeIdSet.has(edge.target)).toBe(true);
      }
    });

    it("preserves forked_from lineage metadata", () => {
      const cloned = cloneLearningMap(sampleTestMap);
      expect(cloned.forkedFrom).toBe("sample-roadmap-1");

      // Forking an already forked map retains original template lineage
      const secondGen = cloneLearningMap(cloned);
      expect(secondGen.forkedFrom).toBe("sample-roadmap-1");
    });

    it("resets progress to clean slate when resetProgress is true", () => {
      const cloned = cloneLearningMap(sampleTestMap, { resetProgress: true });

      for (const bibble of cloned.bibbles) {
        expect(bibble.status).toBe("not-started");
        expect(bibble.progress).toBe(0);
        expect(bibble.readinessState).toBe("root");
        expect(bibble.missingPrereqsCount).toBe(0);
      }
    });

    it("preserves status and progress when resetProgress is false", () => {
      const cloned = cloneLearningMap(sampleTestMap, { resetProgress: false });

      expect(cloned.bibbles[0].status).toBe("completed");
      expect(cloned.bibbles[0].progress).toBe(100);
      expect(cloned.bibbles[1].status).toBe("learning");
      expect(cloned.bibbles[1].progress).toBe(50);
    });

    it("generates fresh resource IDs within cloned bibbles", () => {
      const cloned = cloneLearningMap(sampleTestMap);
      const originalResource = sampleTestMap.bibbles[0].resources![0];
      const clonedResource = cloned.bibbles[0].resources![0];

      expect(clonedResource.label).toBe(originalResource.label);
      expect(clonedResource.url).toBe(originalResource.url);
      expect(clonedResource.id).not.toBe(originalResource.id);
      expect(clonedResource.id).toContain(cloned.bibbles[0].id);
    });

    it("applies custom title or appends (Fork)", () => {
      const clonedWithDefault = cloneLearningMap(sampleTestMap);
      expect(clonedWithDefault.title).toBe("Computer Systems Roadmap (Fork)");

      const clonedWithCustom = cloneLearningMap(sampleTestMap, { newTitle: "Alice's CS Pathway" });
      expect(clonedWithCustom.title).toBe("Alice's CS Pathway");
    });
  });

  describe("forkMap", () => {
    it("persists the cloned map to versioned storage and updates local state", async () => {
      const forked = await forkMap(sampleTestMap, { newTitle: "My Personal Roadmap" });

      expect(forked.title).toBe("My Personal Roadmap");
      expect(forked.version).toBe(1);
      expect(mockSaveMapWithVersion).toHaveBeenCalledWith(forked, "bibble-maps");

      // Verify it was added to local storage
      const storedRaw = window.localStorage.getItem("bibble-maps");
      expect(storedRaw).not.toBeNull();
      const stored = JSON.parse(storedRaw!);
      expect(stored).toHaveLength(1);
      expect(stored[0].id).toBe(forked.id);
    });
  });
});
