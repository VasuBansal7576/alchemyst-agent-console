import { describe, expect, it } from "vitest";
import { ReorderBuffer } from "./reorder-buffer";

interface TestMessage {
  seq: number;
  value: string;
}

const msg = (seq: number): TestMessage => ({ seq, value: String(seq) });

describe("ReorderBuffer", () => {
  it("emits a single in-order element", () => {
    const buffer = new ReorderBuffer<TestMessage>();
    expect(buffer.insert(msg(1)).map((m) => m.seq)).toEqual([1]);
    expect(buffer.expectedSeq).toBe(2);
  });

  it("buffers a fully reversed sequence until seq 1 arrives", () => {
    const buffer = new ReorderBuffer<TestMessage>();
    expect(buffer.insert(msg(5))).toEqual([]);
    expect(buffer.insert(msg(4))).toEqual([]);
    expect(buffer.insert(msg(3))).toEqual([]);
    expect(buffer.insert(msg(2))).toEqual([]);
    expect(buffer.insert(msg(1)).map((m) => m.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it("drops late duplicates", () => {
    const buffer = new ReorderBuffer<TestMessage>();
    expect(buffer.insert(msg(1)).map((m) => m.seq)).toEqual([1]);
    expect(buffer.insert(msg(1))).toEqual([]);
  });

  it("does not duplicate future messages buffered twice", () => {
    const buffer = new ReorderBuffer<TestMessage>();
    expect(buffer.insert(msg(2))).toEqual([]);
    expect(buffer.insert(msg(2))).toEqual([]);
    expect(buffer.insert(msg(1)).map((m) => m.seq)).toEqual([1, 2]);
  });

  it("emits every permutation-like burst in order", () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const buffer = new ReorderBuffer<TestMessage>();
      const values = shuffle(Array.from({ length: 50 }, (_, index) => index + 1), seed);
      const emitted: number[] = [];
      for (const seq of values) {
        emitted.push(...buffer.insert(msg(seq)).map((m) => m.seq));
      }
      expect(emitted).toEqual(Array.from({ length: 50 }, (_, index) => index + 1));
    }
  });

  it("can accept a gap after timeout", () => {
    const buffer = new ReorderBuffer<TestMessage>(1, 100);
    expect(buffer.insert(msg(3), 0)).toEqual([]);
    const gap = buffer.flushExpiredGap(101);
    expect(gap?.missingSeq).toBe(1);
    expect(gap?.ready.map((m) => m.seq)).toEqual([]);
    expect(buffer.insert(msg(2), 102).map((m) => m.seq)).toEqual([2, 3]);
  });
});

function shuffle(values: number[], seed: number): number[] {
  const shuffled = [...values];
  let state = seed;
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const j = state % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
