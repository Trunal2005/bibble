import { describe, expect, it } from "vitest";
import {
  buildAdjacencyList,
  computeNodeReadiness,
  detectCycle,
  findDirectedPath,
  getAllDependentIds,
  getAllPrerequisiteIds,
  getDirectDependentIds,
  getDirectPrerequisiteIds,
  getTopologicalSort,
  validateMapDAG,
} from "./graph-algorithms";
import { sampleMaps } from "@/data/sample-maps";

describe("graph-algorithms", () => {
  describe("buildAdjacencyList and findDirectedPath", () => {
    it("builds an adjacency list correctly", () => {
      const edges = [
        { source: "A", target: "B" },
        { source: "A", target: "C" },
        { source: "B", target: "D" },
      ];
      const adj = buildAdjacencyList(edges);
      expect(adj.get("A")).toEqual(["B", "C"]);
      expect(adj.get("B")).toEqual(["D"]);
      expect(adj.get("C")).toBeUndefined();
    });

    it("finds direct and transitive directed paths", () => {
      const edges = [
        { source: "A", target: "B" },
        { source: "B", target: "C" },
        { source: "C", target: "D" },
      ];
      expect(findDirectedPath("A", "D", edges)).toEqual(["A", "B", "C", "D"]);
      expect(findDirectedPath("A", "B", edges)).toEqual(["A", "B"]);
      expect(findDirectedPath("A", "A", edges)).toEqual(["A"]);
      expect(findDirectedPath("D", "A", edges)).toBeNull();
    });
  });

  describe("detectCycle", () => {
    const nodes = [
      { id: "A", title: "Arrays" },
      { id: "B", title: "Strings" },
      { id: "C", title: "Hashing" },
      { id: "D", title: "Trees" },
    ];

    it("detects and rejects self-loops (source === target)", () => {
      const edges = [{ source: "A", target: "B" }];
      const result = detectCycle(nodes, edges, { source: "A", target: "A" });
      expect(result.hasCycle).toBe(true);
      expect(result.reason).toBe("self-loop");
      expect(result.message).toContain("A concept cannot be its own prerequisite");
    });

    it("identifies duplicate existing edges", () => {
      const edges = [{ source: "A", target: "B" }];
      const result = detectCycle(nodes, edges, { source: "A", target: "B" });
      expect(result.hasCycle).toBe(false);
      expect(result.isDuplicate).toBe(true);
      expect(result.message).toContain("already connected");
    });

    it("allows valid forward DAG edge addition", () => {
      const edges = [
        { source: "A", target: "B" },
        { source: "B", target: "C" },
      ];
      const result = detectCycle(nodes, edges, { source: "A", target: "C" });
      expect(result.hasCycle).toBe(false);
      expect(result.isDuplicate).toBeUndefined();
    });

    it("detects a 2-node immediate cycle (B -> A when A -> B)", () => {
      const edges = [{ source: "A", target: "B" }];
      const result = detectCycle(nodes, edges, { source: "B", target: "A" });
      expect(result.hasCycle).toBe(true);
      expect(result.reason).toBe("cycle");
      expect(result.cyclePath).toEqual(["A", "B", "A"]);
      expect(result.message).toContain("circular dependency");
      expect(result.message).toContain("Arrays → Strings → Arrays");
    });

    it("detects a multi-node transitive cycle (C -> A when A -> B -> C)", () => {
      const edges = [
        { source: "A", target: "B" },
        { source: "B", target: "C" },
      ];
      const result = detectCycle(nodes, edges, { source: "C", target: "A" });
      expect(result.hasCycle).toBe(true);
      expect(result.reason).toBe("cycle");
      expect(result.cyclePath).toEqual(["A", "B", "C", "A"]);
      expect(result.message).toContain("Arrays → Strings → Hashing → Arrays");
    });

    it("allows edges in disconnected components without false positives", () => {
      const edges = [
        { source: "A", target: "B" },
        { source: "C", target: "D" },
      ];
      const result = detectCycle(nodes, edges, { source: "B", target: "C" });
      expect(result.hasCycle).toBe(false);
    });
  });

  describe("validateMapDAG", () => {
    it("confirms valid DAG graph", () => {
      const nodes = [{ id: "A" }, { id: "B" }, { id: "C" }];
      const edges = [
        { source: "A", target: "B" },
        { source: "B", target: "C" },
      ];
      expect(validateMapDAG(nodes, edges)).toEqual({ isDAG: true });
    });

    it("identifies cycles in an invalid graph", () => {
      const nodes = [{ id: "A" }, { id: "B" }, { id: "C" }];
      const edges = [
        { source: "A", target: "B" },
        { source: "B", target: "C" },
        { source: "C", target: "A" },
      ];
      const res = validateMapDAG(nodes, edges);
      expect(res.isDAG).toBe(false);
      expect(res.cyclePath).toBeDefined();
    });

    it("verifies all existing sample maps are valid DAGs", () => {
      for (const map of sampleMaps) {
        const res = validateMapDAG(map.bibbles, map.edges);
        expect(res.isDAG, `Map ${map.id} should be a valid DAG`).toBe(true);
      }
    });
  });

  describe("prerequisite and dependent discovery", () => {
    const edges = [
      { source: "A", target: "B" },
      { source: "A", target: "C" },
      { source: "B", target: "D" },
      { source: "C", target: "D" },
      { source: "D", target: "E" },
    ];

    it("computes direct prerequisites", () => {
      expect(getDirectPrerequisiteIds("D", edges)).toEqual(["B", "C"]);
      expect(getDirectPrerequisiteIds("A", edges)).toEqual([]);
    });

    it("computes direct dependents", () => {
      expect(getDirectDependentIds("A", edges)).toEqual(["B", "C"]);
      expect(getDirectDependentIds("E", edges)).toEqual([]);
    });

    it("computes all transitive prerequisites", () => {
      const prereqsOfE = getAllPrerequisiteIds("E", edges);
      expect(Array.from(prereqsOfE).sort()).toEqual(["A", "B", "C", "D"]);
    });

    it("computes all transitive dependents", () => {
      const dependentsOfA = getAllDependentIds("A", edges);
      expect(Array.from(dependentsOfA).sort()).toEqual(["B", "C", "D", "E"]);
    });
  });

  describe("getTopologicalSort", () => {
    it("topologically sorts a DAG", () => {
      const nodes = [{ id: "A" }, { id: "B" }, { id: "C" }, { id: "D" }];
      const edges = [
        { source: "A", target: "B" },
        { source: "B", target: "C" },
        { source: "A", target: "D" },
      ];
      const result = getTopologicalSort(nodes, edges);
      expect(result.hasCycle).toBe(false);
      expect(result.sortedIds.indexOf("A")).toBeLessThan(result.sortedIds.indexOf("B"));
      expect(result.sortedIds.indexOf("B")).toBeLessThan(result.sortedIds.indexOf("C"));
      expect(result.sortedIds.indexOf("A")).toBeLessThan(result.sortedIds.indexOf("D"));
    });

    it("detects cycle during topological sorting", () => {
      const nodes = [{ id: "A" }, { id: "B" }];
      const edges = [
        { source: "A", target: "B" },
        { source: "B", target: "A" },
      ];
      const result = getTopologicalSort(nodes, edges);
      expect(result.hasCycle).toBe(true);
    });
  });

  describe("computeNodeReadiness", () => {
    const bibbles = [
      { id: "A", title: "Arrays", status: "completed" as const, progress: 100 },
      { id: "B", title: "Strings", status: "learning" as const, progress: 50 },
      { id: "C", title: "Hashing", status: "not-started" as const, progress: 0 },
      { id: "D", title: "Trees", status: "not-started" as const, progress: 0 },
    ];
    const edges = [
      { source: "A", target: "B" },
      { source: "A", target: "C" },
      { source: "B", target: "D" },
    ];

    it("identifies completed concept", () => {
      const res = computeNodeReadiness(bibbles[0], bibbles, edges);
      expect(res.state).toBe("completed");
      expect(res.isCompleted).toBe(true);
      expect(res.isReady).toBe(true);
    });

    it("identifies in-progress concept", () => {
      const res = computeNodeReadiness(bibbles[1], bibbles, edges);
      expect(res.state).toBe("in-progress");
      expect(res.isReady).toBe(true);
      expect(res.isCompleted).toBe(false);
    });

    it("identifies root concept with no prerequisites as ready", () => {
      const rootBibble = { id: "Z", title: "Welcome", status: "not-started" as const, progress: 0 };
      const res = computeNodeReadiness(rootBibble, [rootBibble], []);
      expect(res.state).toBe("root");
      expect(res.isReady).toBe(true);
      expect(res.directPrerequisites).toHaveLength(0);
    });

    it("identifies concept with all prerequisites satisfied as ready", () => {
      // C depends on A. A is completed.
      const res = computeNodeReadiness(bibbles[2], bibbles, edges);
      expect(res.state).toBe("ready");
      expect(res.isReady).toBe(true);
      expect(res.pendingPrerequisites).toHaveLength(0);
      expect(res.directPrerequisites).toHaveLength(1);
    });

    it("identifies concept with incomplete prerequisites as locked", () => {
      // D depends on B. B is at 50% (learning).
      const res = computeNodeReadiness(bibbles[3], bibbles, edges);
      expect(res.state).toBe("locked");
      expect(res.isReady).toBe(false);
      expect(res.pendingPrerequisites).toHaveLength(1);
      expect(res.pendingPrerequisites[0].id).toBe("B");
    });
  });
});
