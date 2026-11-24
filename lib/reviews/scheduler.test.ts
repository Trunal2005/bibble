import { describe, expect, it } from "vitest";
import {
  calculateNextReview,
  buildReviewRecord,
  MIN_EASE_FACTOR,
  DEFAULT_EASE_FACTOR,
  SM2_ALGORITHM_VERSION,
} from "./scheduler";

describe("spaced-review scheduler (SM-2)", () => {
  const clock = new Date("2026-11-23T12:00:00.000Z");

  it("calculates reproducible initial intervals for first-time reviews", () => {
    const again = calculateNextReview(null, "again", clock);
    expect(again.intervalDays).toBe(1);
    expect(again.repetitions).toBe(0);
    expect(again.easeFactor).toBe(2.3); // 2.5 - 0.2

    const hard = calculateNextReview(null, "hard", clock);
    expect(hard.intervalDays).toBe(2);
    expect(hard.repetitions).toBe(1);
    expect(hard.easeFactor).toBe(2.35); // 2.5 - 0.15

    const good = calculateNextReview(null, "good", clock);
    expect(good.intervalDays).toBe(1);
    expect(good.repetitions).toBe(1);
    expect(good.easeFactor).toBe(DEFAULT_EASE_FACTOR);

    const easy = calculateNextReview(null, "easy", clock);
    expect(easy.intervalDays).toBe(4);
    expect(easy.repetitions).toBe(1);
    expect(easy.easeFactor).toBe(2.65); // 2.5 + 0.15
  });

  it("advances interval to 6 days on second 'good' review and compounds on third", () => {
    // Step 1: initial good
    const step1 = calculateNextReview(null, "good", clock);
    expect(step1.intervalDays).toBe(1);
    expect(step1.repetitions).toBe(1);

    // Step 2: 1 day later, second good
    const clock2 = new Date(clock.getTime() + 1 * 24 * 60 * 60 * 1000);
    const step2 = calculateNextReview(
      { intervalDays: step1.intervalDays, repetitions: step1.repetitions, easeFactor: step1.easeFactor, lastReviewedAt: clock.toISOString() },
      "good",
      clock2,
    );
    expect(step2.intervalDays).toBe(6);
    expect(step2.repetitions).toBe(2);

    // Step 3: 6 days later, third good
    const clock3 = new Date(clock2.getTime() + 6 * 24 * 60 * 60 * 1000);
    const step3 = calculateNextReview(
      { intervalDays: step2.intervalDays, repetitions: step2.repetitions, easeFactor: step2.easeFactor, lastReviewedAt: clock2.toISOString() },
      "good",
      clock3,
    );
    // 6 * 2.5 = 15 days
    expect(step3.intervalDays).toBe(15);
    expect(step3.repetitions).toBe(3);
  });

  it("resets interval to 1 day on 'again' regardless of repetition count", () => {
    const previous = {
      intervalDays: 30,
      repetitions: 5,
      easeFactor: 2.5,
      lastReviewedAt: clock.toISOString(),
    };
    const reviewDate = new Date(clock.getTime() + 30 * 24 * 60 * 60 * 1000);
    const res = calculateNextReview(previous, "again", reviewDate);

    expect(res.intervalDays).toBe(1);
    expect(res.repetitions).toBe(0);
    expect(res.easeFactor).toBe(2.3);
  });

  it("never lets easeFactor drop below minimum bound (1.3)", () => {
    const state = {
      intervalDays: 1,
      repetitions: 0,
      easeFactor: 1.4,
      lastReviewedAt: clock.toISOString(),
    };

    // Reviewing 'again' multiple times
    const res1 = calculateNextReview(state, "again", clock);
    expect(res1.easeFactor).toBe(MIN_EASE_FACTOR);

    const res2 = calculateNextReview(res1, "again", clock);
    expect(res2.easeFactor).toBe(MIN_EASE_FACTOR);
  });

  it("rewards overdue reviews that are successfully recalled", () => {
    // Scheduled interval was 5 days, but user reviewed 15 days later (10 days overdue)
    const previous = {
      intervalDays: 5,
      repetitions: 2,
      easeFactor: 2.5,
      lastReviewedAt: clock.toISOString(),
    };
    const overdueClock = new Date(clock.getTime() + 15 * 24 * 60 * 60 * 1000);
    const res = calculateNextReview(previous, "good", overdueClock);

    // Should base expansion on actual retention (15 days * 2.5 = 38 days)
    expect(res.intervalDays).toBe(38);
    expect(res.repetitions).toBe(3);
  });

  it("prevents interval explosion on same-day repeat reviews", () => {
    const previous = {
      intervalDays: 10,
      repetitions: 2,
      easeFactor: 2.5,
      lastReviewedAt: clock.toISOString(),
    };
    // Reviewing 2 hours later on the same day
    const sameDayClock = new Date(clock.getTime() + 2 * 60 * 60 * 1000);
    const res = calculateNextReview(previous, "good", sameDayClock);

    expect(res.intervalDays).toBe(10); // Not multiplied again
    expect(res.repetitions).toBe(2); // Repetition count maintained
  });

  it("builds consistent NodeReviewRecord with history", () => {
    const input = {
      mapId: "map-1",
      nodeId: "node-1",
      nodeTitle: "Dynamic Programming",
      mapTitle: "Algorithms Map",
      rating: "good" as const,
      idempotencyKey: "idem-key-1",
      reviewedAt: clock,
    };

    const record = buildReviewRecord(null, input, "user-123");
    expect(record.id).toBe("map-1:node-1");
    expect(record.userId).toBe("user-123");
    expect(record.nodeTitle).toBe("Dynamic Programming");
    expect(record.algorithmVersion).toBe(SM2_ALGORITHM_VERSION);
    expect(record.lastIdempotencyKey).toBe("idem-key-1");
    expect(record.history).toHaveLength(1);
    expect(record.history[0].idempotencyKey).toBe("idem-key-1");
    expect(record.history[0].rating).toBe("good");
  });
});
