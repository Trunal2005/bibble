import type { Bibble, LearningMap, MapEdge } from "@/types/map";
import { saveMapWithVersion } from "./persistence";
import { getStoredMaps, setStoredMaps } from "./local-storage";

export interface CloneMapOptions {
  newTitle?: string;
  resetProgress?: boolean;
  forkedFromId?: string;
}

/**
 * Generates a collision-resistant unique ID for maps, nodes, and edges.
 */
export function generateUniqueId(prefix: string): string {
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).slice(2, 9);
  return `${prefix}-${timestamp}-${randomStr}`;
}

/**
 * Deep clones a learning map with newly generated IDs for the map and all bibble nodes,
 * atomically rewriting all edge source and target pointers to preserve DAG topology
 * without foreign key violations.
 */
export function cloneLearningMap(
  sourceMap: LearningMap,
  options: CloneMapOptions = {}
): LearningMap {
  const newMapId = generateUniqueId("map");
  const forkedFromId = options.forkedFromId ?? sourceMap.forkedFrom ?? sourceMap.id;

  // 1. Determine title
  let title = options.newTitle;
  if (!title) {
    if (sourceMap.title.startsWith("Copy of ")) {
      title = sourceMap.title;
    } else {
      title = `${sourceMap.title} (Fork)`;
    }
  }

  // 2. Clone bibble nodes and build translation dictionary (oldId -> newId)
  const nodeIdMap = new Map<string, string>();
  const clonedBibbles: Bibble[] = (sourceMap.bibbles ?? []).map((bibble, index) => {
    const newBibbleId = `${generateUniqueId("bibble")}-${index + 1}`;
    nodeIdMap.set(bibble.id, newBibbleId);

    const shouldReset = options.resetProgress ?? false;

    return {
      ...bibble,
      id: newBibbleId,
      status: shouldReset ? "not-started" : bibble.status,
      progress: shouldReset ? 0 : bibble.progress,
      position: { x: bibble.position.x, y: bibble.position.y },
      resources: bibble.resources?.map((res, rIndex) => ({
        ...res,
        id: `${newBibbleId}-res-${rIndex + 1}`,
      })),
      notes: bibble.notes ?? "",
      readinessState: shouldReset ? "root" : bibble.readinessState,
      missingPrereqsCount: shouldReset ? 0 : bibble.missingPrereqsCount,
    };
  });

  // 3. Atomically translate edge pointers
  const clonedEdges: MapEdge[] = [];
  (sourceMap.edges ?? []).forEach((edge) => {
    const newSource = nodeIdMap.get(edge.source);
    const newTarget = nodeIdMap.get(edge.target);

    // Maintain strict referential integrity: only link if both endpoints exist in the clone
    if (newSource && newTarget) {
      clonedEdges.push({
        id: `edge-${newSource}-${newTarget}`,
        source: newSource,
        target: newTarget,
      });
    }
  });

  return {
    id: newMapId,
    title,
    description: sourceMap.description ?? "",
    category: sourceMap.category ?? "Personal growth",
    accent: sourceMap.accent ?? "lavender",
    bibbles: clonedBibbles,
    edges: clonedEdges,
    forkedFrom: forkedFromId,
    version: 1,
  };
}

/**
 * Clones a map and immediately persists it to both cloud (if authenticated)
 * and local storage, guaranteeing it is safely available across sessions.
 */
export async function forkMap(
  sourceMap: LearningMap,
  options: CloneMapOptions & { storageKey?: string } = {}
): Promise<LearningMap> {
  const cloned = cloneLearningMap(sourceMap, options);
  const storageKey = options.storageKey ?? "bibble-maps";

  // Persist with versioning to Supabase (if connected) or local storage
  await saveMapWithVersion(cloned, storageKey);

  // Guarantee user-scoped local storage contains the new map immediately
  try {
    const localMaps = getStoredMaps(storageKey);
    if (!localMaps.some((m) => m.id === cloned.id)) {
      setStoredMaps([...localMaps, cloned], storageKey);
    }
  } catch {
    // Ignore storage quota errors in non-browser environments
  }

  return cloned;
}
