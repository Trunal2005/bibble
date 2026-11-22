import type { LearningMap } from "./map";

export type MapSnapshotTrigger = "save" | "restore" | "initial";

export interface MapSnapshotSummary {
  id: string;
  mapId: string;
  revision: number;
  title: string;
  nodeCount: number;
  edgeCount: number;
  savedAt: string;
  trigger: MapSnapshotTrigger;
}

export interface MapSnapshotDetail extends MapSnapshotSummary {
  snapshot: LearningMap;
}

export interface MapDiffSummary {
  nodesAdded: number;
  nodesRemoved: number;
  nodesModified: number;
  edgesAdded: number;
  edgesRemoved: number;
  titleChanged: boolean;
  descriptionChanged: boolean;
}

export interface SnapshotRestoreResult {
  success: boolean;
  newRevision: number;
  restoredMap: LearningMap | null;
  conflictError?: boolean;
  errorMessage?: string;
}
