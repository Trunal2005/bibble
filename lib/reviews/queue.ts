import type { LearningMap } from "@/types/map";
import type { DueReviewItem, NodeReviewRecord, SpacedReviewSummary } from "@/types/review";
import { loadAllReviews } from "./storage";

export interface GetDueQueueOptions {
  now?: Date;
  limit?: number;
  offset?: number;
  mapId?: string;
}

export interface DueQueueResult {
  items: DueReviewItem[];
  total: number;
  hasMore: boolean;
  summary: SpacedReviewSummary;
}

/**
 * Validates that a node is currently active and completed in the user's available maps.
 */
function isNodeActiveAndCompleted(
  mapId: string,
  nodeId: string,
  maps: LearningMap[],
): { isValid: boolean; nodeTitle?: string; mapTitle?: string } {
  const map = maps.find((m) => m.id === mapId);
  if (!map) return { isValid: false };

  const node = map.bibbles.find((b) => b.id === nodeId);
  if (!node) return { isValid: false };

  // Only completed nodes participate in the spaced review schedule
  const isCompleted = node.status === "completed" || (typeof node.progress === "number" && node.progress >= 100);
  if (!isCompleted) return { isValid: false };

  return { isValid: true, nodeTitle: node.title, mapTitle: map.title };
}

/**
 * Computes the bounded queue of due reviews, filtering out deleted maps/nodes
 * and uncompleted concepts.
 */
export function getDueReviews(
  storage: Storage,
  userId: string | null,
  activeMaps: LearningMap[],
  options: GetDueQueueOptions = {},
): DueQueueResult {
  const now = options.now ?? new Date();
  const nowTime = now.getTime();
  const limit = Math.min(100, Math.max(1, options.limit ?? 20));
  const offset = Math.max(0, options.offset ?? 0);

  const allRecords = loadAllReviews(storage, userId);

  // Validate records against currently active maps
  const validRecords: (NodeReviewRecord & { nodeTitle: string; mapTitle: string })[] = [];
  for (const record of allRecords) {
    if (options.mapId && record.mapId !== options.mapId) continue;
    const { isValid, nodeTitle, mapTitle } = isNodeActiveAndCompleted(record.mapId, record.nodeId, activeMaps);
    if (isValid) {
      validRecords.push({
        ...record,
        nodeTitle: nodeTitle ?? record.nodeTitle ?? "Review Node",
        mapTitle: mapTitle ?? record.mapTitle ?? "Learning Map",
      });
    }
  }

  // Filter due items
  const dueItems: DueReviewItem[] = [];
  let overdueCount = 0;

  for (const record of validRecords) {
    const nextTime = Date.parse(record.nextReviewAt);
    if (isNaN(nextTime)) continue;

    if (nextTime <= nowTime) {
      const overdueMs = Math.max(0, nowTime - nextTime);
      const overdueDays = Math.floor(overdueMs / (24 * 60 * 60 * 1000));
      const isOverdue = overdueDays >= 1;
      if (isOverdue) overdueCount++;

      dueItems.push({
        ...record,
        isOverdue,
        overdueDays,
      });
    }
  }

  // Sort by nextReviewAt ascending (most overdue first)
  dueItems.sort((a, b) => Date.parse(a.nextReviewAt) - Date.parse(b.nextReviewAt));

  const total = dueItems.length;
  const pagedItems = dueItems.slice(offset, offset + limit);
  const hasMore = offset + limit < total;

  // Next upcoming due date among non-due valid records
  const upcoming = validRecords
    .filter((r) => Date.parse(r.nextReviewAt) > nowTime)
    .sort((a, b) => Date.parse(a.nextReviewAt) - Date.parse(b.nextReviewAt));

  const nextDueAt = upcoming.length > 0 ? upcoming[0].nextReviewAt : (dueItems.length > 0 ? dueItems[0].nextReviewAt : null);

  const summary: SpacedReviewSummary = {
    dueCount: total,
    overdueCount,
    totalTrackedNodes: validRecords.length,
    nextDueAt,
  };

  return {
    items: pagedItems,
    total,
    hasMore,
    summary,
  };
}
