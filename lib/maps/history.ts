import type { LearningMap } from "@/types/map";
import type {
  MapDiffSummary,
  MapSnapshotDetail,
  MapSnapshotSummary,
  MapSnapshotTrigger,
  SnapshotRestoreResult,
} from "@/types/history";
import { createClient } from "@/lib/supabase/client";

export const MAX_REVISIONS_PER_MAP = 20;
export const GUEST_HISTORY_STORAGE_KEY_PREFIX = "bibble_map_history_";

function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}

function cloneMap(map: LearningMap): LearningMap {
  if (typeof structuredClone === "function") {
    return structuredClone(map);
  }
  return JSON.parse(JSON.stringify(map));
}

export function computeMapDiff(current: LearningMap, target: LearningMap): MapDiffSummary {
  const currentNodes = new Map(current.bibbles.map((b) => [b.id, b]));
  const targetNodes = new Map(target.bibbles.map((b) => [b.id, b]));

  let nodesAdded = 0;
  let nodesRemoved = 0;
  let nodesModified = 0;

  for (const [id, node] of targetNodes.entries()) {
    const existing = currentNodes.get(id);
    if (!existing) {
      nodesAdded++;
    } else {
      if (
        existing.title !== node.title ||
        existing.status !== node.status ||
        existing.progress !== node.progress ||
        existing.description !== node.description ||
        existing.notes !== node.notes ||
        existing.position.x !== node.position.x ||
        existing.position.y !== node.position.y
      ) {
        nodesModified++;
      }
    }
  }

  for (const id of currentNodes.keys()) {
    if (!targetNodes.has(id)) {
      nodesRemoved++;
    }
  }

  const currentEdges = new Set(current.edges.map((e) => `${e.source}->${e.target}`));
  const targetEdges = new Set(target.edges.map((e) => `${e.source}->${e.target}`));

  let edgesAdded = 0;
  let edgesRemoved = 0;

  for (const edge of targetEdges) {
    if (!currentEdges.has(edge)) edgesAdded++;
  }
  for (const edge of currentEdges) {
    if (!targetEdges.has(edge)) edgesRemoved++;
  }

  return {
    nodesAdded,
    nodesRemoved,
    nodesModified,
    edgesAdded,
    edgesRemoved,
    titleChanged: current.title !== target.title,
    descriptionChanged: current.description !== target.description,
  };
}

export function createSnapshotFromMap(
  map: LearningMap,
  revision: number,
  trigger: MapSnapshotTrigger = "save",
  id?: string
): MapSnapshotDetail {
  const snapshotMap = cloneMap(map);
  const now = new Date().toISOString();
  const snapshotId = id ?? `snap_${map.id}_r${revision}_${Date.now()}`;

  return {
    id: snapshotId,
    mapId: map.id,
    revision,
    title: map.title,
    nodeCount: map.bibbles.length,
    edgeCount: map.edges.length,
    savedAt: now,
    trigger,
    snapshot: snapshotMap,
  };
}

export function getLocalHistoryStorageKey(mapId: string): string {
  return `${GUEST_HISTORY_STORAGE_KEY_PREFIX}${mapId}`;
}

export function pruneSnapshots(
  snapshots: MapSnapshotDetail[],
  maxRevisions: number = MAX_REVISIONS_PER_MAP
): MapSnapshotDetail[] {
  if (snapshots.length <= maxRevisions) {
    return snapshots;
  }
  // Sort descending by revision/savedAt
  const sorted = [...snapshots].sort((a, b) => b.revision - a.revision || b.savedAt.localeCompare(a.savedAt));
  return sorted.slice(0, maxRevisions);
}

function getStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
    const g = globalThis as unknown as { localStorage?: Storage };
    if (typeof g !== "undefined" && g.localStorage) return g.localStorage;
  } catch {
    return null;
  }
  return null;
}

export function loadLocalSnapshots(mapId: string): MapSnapshotDetail[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(getLocalHistoryStorageKey(mapId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is MapSnapshotDetail =>
        Boolean(s && typeof s.id === "string" && s.mapId === mapId && s.snapshot && typeof s.revision === "number")
    );
  } catch {
    return [];
  }
}

export function saveLocalSnapshots(mapId: string, snapshots: MapSnapshotDetail[]): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    const pruned = pruneSnapshots(snapshots, MAX_REVISIONS_PER_MAP);
    storage.setItem(getLocalHistoryStorageKey(mapId), JSON.stringify(pruned));
  } catch {
    // Gracefully ignore local storage full errors
  }
}

export function clearLocalSnapshots(mapId: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(getLocalHistoryStorageKey(mapId));
  } catch {
    // Ignore
  }
}

export async function saveSnapshotToSupabase(
  snapshot: MapSnapshotDetail,
  maxRevisions: number = MAX_REVISIONS_PER_MAP
): Promise<boolean> {
  if (!isSupabaseConfigured()) return true;
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return true;

    const row = {
      id: snapshot.id,
      map_id: snapshot.mapId,
      user_id: user.id,
      revision: snapshot.revision,
      title: snapshot.title,
      node_count: snapshot.nodeCount,
      edge_count: snapshot.edgeCount,
      trigger: snapshot.trigger,
      snapshot_data: snapshot.snapshot,
      created_at: snapshot.savedAt,
    };

    const { error } = await supabase.from("learning_map_snapshots").upsert(row);
    if (error) return false;

    // Prune excess snapshots in background
    await pruneSupabaseSnapshots(snapshot.mapId, maxRevisions);
    return true;
  } catch {
    return false;
  }
}

export async function pruneSupabaseSnapshots(
  mapId: string,
  maxRevisions: number = MAX_REVISIONS_PER_MAP
): Promise<boolean> {
  if (!isSupabaseConfigured()) return true;
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return true;

    const { data: rows, error } = await supabase
      .from("learning_map_snapshots")
      .select("id, revision, created_at")
      .eq("map_id", mapId)
      .order("revision", { ascending: false });

    if (error || !rows || rows.length <= maxRevisions) return true;

    const excessIds = rows.slice(maxRevisions).map((r) => r.id);
    if (excessIds.length > 0) {
      await supabase.from("learning_map_snapshots").delete().in("id", excessIds);
    }
    return true;
  } catch {
    return false;
  }
}

export async function listSnapshotsFromSupabase(mapId: string): Promise<MapSnapshotSummary[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
      .from("learning_map_snapshots")
      .select("id, map_id, revision, title, node_count, edge_count, created_at, trigger")
      .eq("map_id", mapId)
      .order("revision", { ascending: false });

    if (error || !data) return [];

    return data.map((row) => ({
      id: row.id,
      mapId: row.map_id,
      revision: row.revision,
      title: row.title,
      nodeCount: row.node_count,
      edgeCount: row.edge_count,
      savedAt: row.created_at,
      trigger: row.trigger as MapSnapshotTrigger,
    }));
  } catch {
    return [];
  }
}

export async function loadSnapshotFromSupabase(
  mapId: string,
  snapshotId: string
): Promise<MapSnapshotDetail | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from("learning_map_snapshots")
      .select("id, map_id, revision, title, node_count, edge_count, created_at, trigger, snapshot_data")
      .eq("map_id", mapId)
      .eq("id", snapshotId)
      .maybeSingle();

    if (error || !data) return null;

    return {
      id: data.id,
      mapId: data.map_id,
      revision: data.revision,
      title: data.title,
      nodeCount: data.node_count,
      edgeCount: data.edge_count,
      savedAt: data.created_at,
      trigger: data.trigger as MapSnapshotTrigger,
      snapshot: data.snapshot_data as LearningMap,
    };
  } catch {
    return null;
  }
}

export async function recordMapRevision(
  map: LearningMap,
  revision: number,
  trigger: MapSnapshotTrigger = "save"
): Promise<MapSnapshotDetail> {
  const snapshot = createSnapshotFromMap(map, revision, trigger);

  // Always keep a local copy for resilience/guest mode
  const localList = loadLocalSnapshots(map.id);
  const updatedList = [snapshot, ...localList.filter((s) => s.id !== snapshot.id)];
  saveLocalSnapshots(map.id, updatedList);

  // If cloud Supabase is active, persist to cloud
  await saveSnapshotToSupabase(snapshot);

  return snapshot;
}

export async function listMapRevisions(mapId: string): Promise<MapSnapshotSummary[]> {
  // Check Supabase first if configured
  if (isSupabaseConfigured()) {
    try {
      const cloudSnapshots = await listSnapshotsFromSupabase(mapId);
      if (cloudSnapshots.length > 0) return cloudSnapshots;
    } catch {
      // Fallback to local
    }
  }

  // Fallback to local snapshots
  const local = loadLocalSnapshots(mapId);
  return local.map((s) => ({
    id: s.id,
    mapId: s.mapId,
    revision: s.revision,
    title: s.title,
    nodeCount: s.nodeCount,
    edgeCount: s.edgeCount,
    savedAt: s.savedAt,
    trigger: s.trigger,
  }));
}

export async function getMapRevisionDetail(
  mapId: string,
  snapshotId: string
): Promise<MapSnapshotDetail | null> {
  if (isSupabaseConfigured()) {
    try {
      const cloud = await loadSnapshotFromSupabase(mapId, snapshotId);
      if (cloud) return cloud;
    } catch {
      // Fallback to local
    }
  }

  const local = loadLocalSnapshots(mapId);
  return local.find((s) => s.id === snapshotId) ?? null;
}

export async function restoreMapRevision(params: {
  mapId: string;
  snapshotId: string;
  currentRevision: number;
  expectedRevision: number;
}): Promise<SnapshotRestoreResult> {
  const { mapId, snapshotId, currentRevision, expectedRevision } = params;

  // Stale version check: prevent silent overwrite if current has moved past expected
  if (currentRevision !== expectedRevision) {
    return {
      success: false,
      conflictError: true,
      errorMessage: `Concurrency conflict: current map revision (${currentRevision}) does not match expected revision (${expectedRevision}). Reload before restoring.`,
      newRevision: currentRevision,
      restoredMap: null,
    };
  }

  const snapshotDetail = await getMapRevisionDetail(mapId, snapshotId);
  if (!snapshotDetail || !snapshotDetail.snapshot) {
    return {
      success: false,
      conflictError: false,
      errorMessage: "Snapshot not found or corrupted.",
      newRevision: currentRevision,
      restoredMap: null,
    };
  }

  // Reconstitute restored map with new revision
  const newRevision = currentRevision + 1;
  const restoredMap = cloneMap(snapshotDetail.snapshot);

  // Record this restoration as an audited snapshot in history
  await recordMapRevision(restoredMap, newRevision, "restore");

  return {
    success: true,
    newRevision,
    restoredMap,
  };
}
