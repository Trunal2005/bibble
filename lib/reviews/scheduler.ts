import type { NodeReviewRecord, ReviewRating, SubmitReviewInput } from "@/types/review";

export const SM2_ALGORITHM_VERSION = "sm2-v1";
export const MIN_EASE_FACTOR = 1.3;
export const DEFAULT_EASE_FACTOR = 2.5;

export interface SchedulingResult {
  intervalDays: number;
  easeFactor: number;
  repetitions: number;
  nextReviewAt: string;
}

/**
 * Deterministically computes the next review interval and ease factor
 * using modified SuperMemo-2 (SM-2) algorithm.
 */
export function calculateNextReview(
  previous: Partial<NodeReviewRecord> | null | undefined,
  rating: ReviewRating,
  reviewDate: Date = new Date(),
): SchedulingResult {
  const prevEase = previous?.easeFactor ?? DEFAULT_EASE_FACTOR;
  const prevReps = previous?.repetitions ?? 0;
  const prevInterval = previous?.intervalDays ?? 0;

  let intervalDays = 1;
  let easeFactor = prevEase;
  let repetitions = prevReps;

  // Check elapsed days since last review if any
  let daysSinceLastReview = 0;
  if (previous?.lastReviewedAt) {
    const lastDate = new Date(previous.lastReviewedAt);
    if (!isNaN(lastDate.getTime())) {
      daysSinceLastReview = Math.max(
        0,
        (reviewDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24),
      );
    }
  }

  const isSameDayReview = previous?.lastReviewedAt != null && daysSinceLastReview < 0.9;

  switch (rating) {
    case "again": {
      // Complete blackout: reset repetitions, interval to 1 day, penalty on ease
      repetitions = 0;
      intervalDays = 1;
      easeFactor = Math.max(MIN_EASE_FACTOR, prevEase - 0.2);
      break;
    }
    case "hard": {
      // Struggled: keep repetitions, modest interval growth (x1.2), minor penalty
      repetitions = Math.max(1, prevReps);
      if (prevInterval <= 1) {
        intervalDays = 2;
      } else {
        intervalDays = Math.max(1, Math.round(prevInterval * 1.2));
      }
      easeFactor = Math.max(MIN_EASE_FACTOR, prevEase - 0.15);
      break;
    }
    case "good": {
      // Normal successful recall
      if (prevReps === 0) {
        intervalDays = 1;
      } else if (prevReps === 1) {
        intervalDays = 6;
      } else {
        // If overdue and recalled successfully, reward with elapsed base
        const base = daysSinceLastReview > prevInterval ? daysSinceLastReview : prevInterval;
        intervalDays = Math.max(1, Math.round(base * prevEase));
      }
      // If same-day review, do not multiply interval repeatedly
      if (isSameDayReview && prevInterval > 0) {
        intervalDays = prevInterval;
      } else {
        repetitions = prevReps + 1;
      }
      easeFactor = Math.max(MIN_EASE_FACTOR, prevEase);
      break;
    }
    case "easy": {
      // Instant effortless recall
      if (prevReps === 0) {
        intervalDays = 4;
      } else if (prevReps === 1) {
        intervalDays = 10;
      } else {
        const base = daysSinceLastReview > prevInterval ? daysSinceLastReview : prevInterval;
        intervalDays = Math.max(1, Math.round(base * prevEase * 1.3));
      }
      if (isSameDayReview && prevInterval > 0) {
        intervalDays = Math.max(prevInterval, 4);
      } else {
        repetitions = prevReps + 1;
      }
      easeFactor = Math.max(MIN_EASE_FACTOR, prevEase + 0.15);
      break;
    }
  }

  // Round ease factor to 2 decimal places to avoid floating point drift
  easeFactor = Math.round(easeFactor * 100) / 100;

  const nextReviewDate = new Date(reviewDate.getTime() + intervalDays * 24 * 60 * 60 * 1000);

  return {
    intervalDays,
    easeFactor,
    repetitions,
    nextReviewAt: nextReviewDate.toISOString(),
  };
}

/**
 * Builds or updates a NodeReviewRecord given review submission input.
 */
export function buildReviewRecord(
  existing: NodeReviewRecord | null | undefined,
  input: SubmitReviewInput,
  userId: string | null = null,
): NodeReviewRecord {
  const reviewedAtDate = input.reviewedAt
    ? typeof input.reviewedAt === "string"
      ? new Date(input.reviewedAt)
      : input.reviewedAt
    : new Date();

  const reviewedAtIso = reviewedAtDate.toISOString();
  const schedule = calculateNextReview(existing, input.rating, reviewedAtDate);

  const historyEntry = {
    reviewedAt: reviewedAtIso,
    rating: input.rating,
    intervalDays: schedule.intervalDays,
    easeFactor: schedule.easeFactor,
    idempotencyKey: input.idempotencyKey,
  };

  const id = `${input.mapId}:${input.nodeId}`;
  const nowIso = new Date().toISOString();

  return {
    id,
    userId,
    mapId: input.mapId,
    nodeId: input.nodeId,
    nodeTitle: input.nodeTitle ?? existing?.nodeTitle,
    mapTitle: input.mapTitle ?? existing?.mapTitle,
    intervalDays: schedule.intervalDays,
    easeFactor: schedule.easeFactor,
    repetitions: schedule.repetitions,
    lastReviewedAt: reviewedAtIso,
    nextReviewAt: schedule.nextReviewAt,
    lastRating: input.rating,
    algorithmVersion: SM2_ALGORITHM_VERSION,
    lastIdempotencyKey: input.idempotencyKey,
    history: existing ? [...existing.history, historyEntry] : [historyEntry],
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
  };
}
