import { describe, expect, it } from "vitest";
import { SlidingDedupWindow } from "./sliding-dedup-window";

describe("SlidingDedupWindow", () => {
  it("accepts new seqs and rejects duplicates", () => {
    const dedup = new SlidingDedupWindow(1000);
    expect(dedup.add(1, 0)).toBe(true);
    expect(dedup.add(1, 10)).toBe(false);
    expect(dedup.has(1, 20)).toBe(true);
  });

  it("evicts by time boundary", () => {
    const dedup = new SlidingDedupWindow(1000);
    dedup.add(1, 0);
    expect(dedup.has(1, 1000)).toBe(true);
    expect(dedup.has(1, 1001)).toBe(false);
  });

  it("keeps O(1)-style front eviction with many entries", () => {
    const dedup = new SlidingDedupWindow(30);
    for (let seq = 1; seq <= 1000; seq += 1) {
      dedup.add(seq, seq);
    }
    expect(dedup.has(1, 1000)).toBe(false);
    expect(dedup.has(1000, 1000)).toBe(true);
    expect(dedup.size).toBeLessThanOrEqual(31);
  });

  it("hydrates persisted seqs", () => {
    const dedup = new SlidingDedupWindow(1000);
    dedup.reset([8, 9, 10], 100);
    expect(dedup.has(9, 200)).toBe(true);
    expect(dedup.add(11, 200)).toBe(true);
    expect(dedup.snapshot()).toEqual([8, 9, 10, 11]);
  });
});
