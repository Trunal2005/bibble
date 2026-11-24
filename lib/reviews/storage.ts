import type { NodeReviewRecord, SubmitReviewInput } from "@/types/review";
import { buildReviewRecord } from "./scheduler";

export const REVIEW_CHANGE_EVENT = "bibble-review-changed";

let activeReviewUser: string | null | undefined = null;

export function reviewPrefix(userId: string | null): string {
  return `bibble-reviews-v1:${userId ?? "guest"}:`;
}

export function setReviewIdentity(userId: string | null | undefined): void {
  activeReviewUser = userId;
  notifyReviewChange();
}

export function getReviewIdentity(): string | null | undefined {
  return activeReviewUser;
}

export function notifyReviewChange(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(REVIEW_CHANGE_EVENT));
  }
}

export function makeRecordKey(userId: string | null, mapId: string, nodeId: string): string {
  return `${reviewPrefix(userId)}record:${mapId}:${nodeId}`;
}

/**
 * Loads all reviews for a specified user or guest namespace from storage.
 */
export function loadAllReviews(storage: Storage, userId: string | null): NodeReviewRecord[] {
  const prefix = `${reviewPrefix(userId)}record:`;
  const records: NodeReviewRecord[] = [];

  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(prefix)) continue;
    const raw = storage.getItem(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as NodeReviewRecord;
      if (parsed && typeof parsed === "object" && parsed.id && parsed.mapId && parsed.nodeId) {
        records.push(parsed);
      }
    } catch {
      // Ignore corrupted records without deleting them
    }
  }

  return records.sort((a, b) => Date.parse(a.nextReviewAt) - Date.parse(b.nextReviewAt));
}

/**
 * Loads a single review record for a specific map and node.
 */
export function loadReview(
  storage: Storage,
  userId: string | null,
  mapId: string,
  nodeId: string,
): NodeReviewRecord | null {
  const key = makeRecordKey(userId, mapId, nodeId);
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as NodeReviewRecord;
  } catch {
    return null;
  }
}

/**
 * Saves a review record.
 */
export function saveReview(storage: Storage, record: NodeReviewRecord): void {
  const key = makeRecordKey(record.userId, record.mapId, record.nodeId);
  storage.setItem(key, JSON.stringify(record));
  notifyReviewChange();
}

/**
 * Submits a review idempotently. If the submission with the same idempotencyKey
 * was already recorded for this map/node, returns the existing record without advancing interval.
 */
export function submitReviewIdempotent(
  storage: Storage,
  userId: string | null,
  input: SubmitReviewInput,
): { record: NodeReviewRecord; isDuplicate: boolean } {
  const existing = loadReview(storage, userId, input.mapId, input.nodeId);

  // Check idempotency key in last submission or history
  if (
    existing &&
    (existing.lastIdempotencyKey === input.idempotencyKey ||
      existing.history.some((h) => h.idempotencyKey === input.idempotencyKey))
  ) {
    return { record: existing, isDuplicate: true };
  }

  const record = buildReviewRecord(existing, input, userId);
  saveReview(storage, record);
  return { record, isDuplicate: false };
}

/**
 * Removes review records when a map is deleted.
 */
export function deleteReviewsForMap(storage: Storage, userId: string | null, mapId: string): number {
  const prefix = `${reviewPrefix(userId)}record:${mapId}:`;
  const keysToDelete: string[] = [];

  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(prefix)) {
      keysToDelete.push(key);
    }
  }

  for (const k of keysToDelete) {
    storage.removeItem(k);
  }

  if (keysToDelete.length > 0) notifyReviewChange();
  return keysToDelete.length;
}

/**
 * Removes review records when a node is deleted.
 */
export function deleteReviewForNode(
  storage: Storage,
  userId: string | null,
  mapId: string,
  nodeId: string,
): boolean {
  const key = makeRecordKey(userId, mapId, nodeId);
  if (storage.getItem(key) !== null) {
    storage.removeItem(key);
    notifyReviewChange();
    return true;
  }
  return false;
}

/**
 * Migrates guest review records into an authenticated user's account namespace.
 */
export function migrateGuestReviews(storage: Storage, targetUserId: string): number {
  if (!targetUserId || targetUserId === "guest") return 0;

  const guestReviews = loadAllReviews(storage, null);
  if (guestReviews.length === 0) return 0;

  let migratedCount = 0;
  for (const guestRecord of guestReviews) {
    const targetKey = makeRecordKey(targetUserId, guestRecord.mapId, guestRecord.nodeId);
    // Don't overwrite existing target account reviews
    if (!storage.getItem(targetKey)) {
      const migratedRecord: NodeReviewRecord = {
        ...guestRecord,
        userId: targetUserId,
        updatedAt: new Date().toISOString(),
      };
      storage.setItem(targetKey, JSON.stringify(migratedRecord));
      migratedCount++;
    }
    // Clean up guest copy
    const guestKey = makeRecordKey(null, guestRecord.mapId, guestRecord.nodeId);
    storage.removeItem(guestKey);
  }

  if (migratedCount > 0) notifyReviewChange();
  return migratedCount;
}
