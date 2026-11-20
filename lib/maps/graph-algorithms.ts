import type { Bibble, BibbleStatus, MapEdge } from "@/types/map";

export type NodeReadinessState = "completed" | "in-progress" | "root" | "ready" | "locked";

export interface NodeReadiness {
  state: NodeReadinessState;
  isReady: boolean;
  isCompleted: boolean;
  directPrerequisites: Array<{ id: string; title: string; status: BibbleStatus; progress: number }>;
  pendingPrerequisites: Array<{ id: string; title: string; status: BibbleStatus; progress: number }>;
}

export interface CycleDetectionResult {
  hasCycle: boolean;
  reason?: "self-loop" | "cycle";
  isDuplicate?: boolean;
  cyclePath?: string[];
  message?: string;
}

export interface DAGValidationResult {
  isDAG: boolean;
  cyclePath?: string[];
}

/**
 * Builds an adjacency list from directed edges (source -> target).
 */
export function buildAdjacencyList(edges: Array<Pick<MapEdge, "source" | "target">>): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const edge of edges) {
    if (!edge.source || !edge.target) continue;
    const targets = adj.get(edge.source) ?? [];
    targets.push(edge.target);
    adj.set(edge.source, targets);
  }
  return adj;
}

/**
 * Finds a directed path between startId and endId using BFS.
 * Returns an array of node IDs from startId to endId, or null if no path exists.
 */
export function findDirectedPath(
  startId: string,
  endId: string,
  edges: Array<Pick<MapEdge, "source" | "target">>,
): string[] | null {
  if (startId === endId) return [startId];

  const adj = buildAdjacencyList(edges);
  const queue: string[] = [startId];
  const visited = new Set<string>([startId]);
  const parent = new Map<string, string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === endId) {
      // Reconstruct path
      const path: string[] = [];
      let step: string | undefined = endId;
      while (step) {
        path.unshift(step);
        step = parent.get(step);
      }
      return path;
    }

    const neighbors = adj.get(current) ?? [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        parent.set(neighbor, current);
        queue.push(neighbor);
      }
    }
  }

  return null;
}

/**
 * Evaluates whether adding candidateConnection (source -> target) to current edges creates a cycle.
 * In a directed graph, adding u -> v creates a cycle iff there is already a directed path from v to u.
 */
export function detectCycle(
  nodes: Array<{ id: string; title?: string }>,
  edges: Array<Pick<MapEdge, "source" | "target">>,
  candidateConnection: { source: string; target: string },
): CycleDetectionResult {
  const { source, target } = candidateConnection;

  // 1. Self-loop check
  if (source === target) {
    return {
      hasCycle: true,
      reason: "self-loop",
      cyclePath: [source],
      message: "A concept cannot be its own prerequisite.",
    };
  }

  // 2. Duplicate connection check
  const duplicate = edges.some((edge) => edge.source === source && edge.target === target);
  if (duplicate) {
    return {
      hasCycle: false,
      isDuplicate: true,
      message: "These concepts are already connected.",
    };
  }

  // 3. Cycle check: is there already a path from target to source?
  const existingPath = findDirectedPath(target, source, edges);
  if (existingPath) {
    const cyclePath = [...existingPath, target];
    const nodeMap = new Map(nodes.map((n) => [n.id, n.title || n.id]));
    const cycleTitles = cyclePath.map((id) => nodeMap.get(id) ?? id);

    return {
      hasCycle: true,
      reason: "cycle",
      cyclePath,
      message: `Connecting these concepts creates a circular dependency: ${cycleTitles.join(" → ")}. Roadmaps follow a clear learning order.`,
    };
  }

  return { hasCycle: false };
}

/**
 * Validates whether an entire set of nodes and edges forms a valid Directed Acyclic Graph (DAG).
 */
export function validateMapDAG(
  nodes: Array<{ id: string }>,
  edges: Array<Pick<MapEdge, "source" | "target">>,
): DAGValidationResult {
  const adj = buildAdjacencyList(edges);
  const nodeIds = new Set(nodes.map((n) => n.id));

  // States: 0 = unvisited, 1 = visiting (in recursion stack), 2 = visited
  const state = new Map<string, number>();
  const parent = new Map<string, string>();
  let cyclePath: string[] | undefined;

  function dfs(u: string, stack: string[]): boolean {
    state.set(u, 1);
    stack.push(u);

    const neighbors = adj.get(u) ?? [];
    for (const v of neighbors) {
      if (!nodeIds.has(v)) continue;

      const vState = state.get(v) ?? 0;
      if (vState === 1) {
        // Back edge found!
        const cycleStartIndex = stack.indexOf(v);
        cyclePath = [...stack.slice(cycleStartIndex), v];
        return true;
      }

      if (vState === 0) {
        parent.set(v, u);
        if (dfs(v, stack)) return true;
      }
    }

    stack.pop();
    state.set(u, 2);
    return false;
  }

  for (const node of nodes) {
    if ((state.get(node.id) ?? 0) === 0) {
      if (dfs(node.id, [])) {
        return { isDAG: false, cyclePath };
      }
    }
  }

  return { isDAG: true };
}

/**
 * Returns IDs of immediate direct prerequisites (nodes with an edge pointing to nodeId).
 */
export function getDirectPrerequisiteIds(
  nodeId: string,
  edges: Array<Pick<MapEdge, "source" | "target">>,
): string[] {
  const prereqs: string[] = [];
  for (const edge of edges) {
    if (edge.target === nodeId && !prereqs.includes(edge.source)) {
      prereqs.push(edge.source);
    }
  }
  return prereqs;
}

/**
 * Returns IDs of immediate direct dependents (nodes that nodeId points to).
 */
export function getDirectDependentIds(
  nodeId: string,
  edges: Array<Pick<MapEdge, "source" | "target">>,
): string[] {
  const dependents: string[] = [];
  for (const edge of edges) {
    if (edge.source === nodeId && !dependents.includes(edge.target)) {
      dependents.push(edge.target);
    }
  }
  return dependents;
}

/**
 * Computes all transitive prerequisites of a node via BFS.
 */
export function getAllPrerequisiteIds(
  nodeId: string,
  edges: Array<Pick<MapEdge, "source" | "target">>,
): Set<string> {
  const result = new Set<string>();
  const queue: string[] = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const direct = getDirectPrerequisiteIds(current, edges);
    for (const prereq of direct) {
      if (!result.has(prereq)) {
        result.add(prereq);
        queue.push(prereq);
      }
    }
  }

  return result;
}

/**
 * Computes all transitive dependents of a node via BFS.
 */
export function getAllDependentIds(
  nodeId: string,
  edges: Array<Pick<MapEdge, "source" | "target">>,
): Set<string> {
  const result = new Set<string>();
  const queue: string[] = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const direct = getDirectDependentIds(current, edges);
    for (const dependent of direct) {
      if (!result.has(dependent)) {
        result.add(dependent);
        queue.push(dependent);
      }
    }
  }

  return result;
}

/**
 * Computes a valid topological ordering of concepts using Kahn's algorithm.
 */
export function getTopologicalSort(
  nodes: Array<{ id: string }>,
  edges: Array<Pick<MapEdge, "source" | "target">>,
): { sortedIds: string[]; hasCycle: boolean } {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adj.set(node.id, []);
  }

  for (const edge of edges) {
    if (inDegree.has(edge.source) && inDegree.has(edge.target)) {
      adj.get(edge.source)!.push(edge.target);
      inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(id);
  }

  const sortedIds: string[] = [];
  while (queue.length > 0) {
    const u = queue.shift()!;
    sortedIds.push(u);

    for (const v of adj.get(u) ?? []) {
      const deg = (inDegree.get(v) ?? 1) - 1;
      inDegree.set(v, deg);
      if (deg === 0) queue.push(v);
    }
  }

  return {
    sortedIds,
    hasCycle: sortedIds.length < nodes.length,
  };
}

/**
 * Evaluates the readiness status of a node based on its completion state and prerequisite completion.
 */
export function computeNodeReadiness(
  targetBibble: Pick<Bibble, "id" | "status" | "progress">,
  allBibbles: Array<Pick<Bibble, "id" | "title" | "status" | "progress">>,
  edges: Array<Pick<MapEdge, "source" | "target">>,
): NodeReadiness {
  const bibbleMap = new Map(allBibbles.map((b) => [b.id, b]));
  const directPrereqIds = getDirectPrerequisiteIds(targetBibble.id, edges);

  const directPrerequisites = directPrereqIds
    .map((id) => bibbleMap.get(id))
    .filter((b): b is NonNullable<typeof b> => Boolean(b))
    .map((b) => ({
      id: b.id,
      title: b.title,
      status: b.status,
      progress: b.progress,
    }));

  const pendingPrerequisites = directPrerequisites.filter(
    (b) => b.status !== "completed" && b.progress < 100,
  );

  // 1. Completed
  if (targetBibble.status === "completed" || targetBibble.progress >= 100) {
    return {
      state: "completed",
      isReady: true,
      isCompleted: true,
      directPrerequisites,
      pendingPrerequisites,
    };
  }

  // 2. In progress
  if (targetBibble.status === "learning" || targetBibble.progress > 0) {
    return {
      state: "in-progress",
      isReady: true,
      isCompleted: false,
      directPrerequisites,
      pendingPrerequisites,
    };
  }

  // 3. Root concept (no prerequisites)
  if (directPrerequisites.length === 0) {
    return {
      state: "root",
      isReady: true,
      isCompleted: false,
      directPrerequisites,
      pendingPrerequisites: [],
    };
  }

  // 4. Prerequisites met
  if (pendingPrerequisites.length === 0) {
    return {
      state: "ready",
      isReady: true,
      isCompleted: false,
      directPrerequisites,
      pendingPrerequisites: [],
    };
  }

  // 5. Blocked / Waiting on prerequisites
  return {
    state: "locked",
    isReady: false,
    isCompleted: false,
    directPrerequisites,
    pendingPrerequisites,
  };
}

/**
 * Annotates a list of canvas nodes with their latest readiness state based on current edges.
 */
export function annotateNodesWithReadiness<T extends { data: Bibble & Record<string, unknown> }>(
  nodes: T[],
  edges: Array<Pick<MapEdge, "source" | "target">>,
): T[] {
  const allBibbles = nodes.map((n) => n.data);
  return nodes.map((node) => {
    const readiness = computeNodeReadiness(node.data, allBibbles, edges);
    if (
      node.data.readinessState === readiness.state &&
      node.data.missingPrereqsCount === readiness.pendingPrerequisites.length
    ) {
      return node;
    }
    return {
      ...node,
      data: {
        ...node.data,
        readinessState: readiness.state,
        missingPrereqsCount: readiness.pendingPrerequisites.length,
      },
    };
  });
}

