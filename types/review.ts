export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

export interface ReviewHistoryEntry {
  reviewedAt: string; // ISO timestamp
  rating: ReviewRating;
  intervalDays: number;
  easeFactor: number;
  idempotencyKey?: string;
}

export interface NodeReviewRecord {
  id: string; // `${mapId}:${nodeId}`
  userId: string | null;
  mapId: string;
  nodeId: string;
  nodeTitle?: string;
  mapTitle?: string;
  intervalDays: number;
  easeFactor: number;
  repetitions: number;
  lastReviewedAt: string; // ISO timestamp
  nextReviewAt: string; // ISO timestamp
  lastRating: ReviewRating;
  algorithmVersion: string;
  lastIdempotencyKey?: string;
  history: ReviewHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface SubmitReviewInput {
  mapId: string;
  nodeId: string;
  nodeTitle?: string;
  mapTitle?: string;
  rating: ReviewRating;
  idempotencyKey: string;
  reviewedAt?: string | Date;
}

export interface DueReviewItem extends NodeReviewRecord {
  isOverdue: boolean;
  overdueDays: number;
}

export interface SpacedReviewSummary {
  dueCount: number;
  overdueCount: number;
  totalTrackedNodes: number;
  nextDueAt: string | null;
}
