import { MinHeap } from "./min-heap";

export interface Sequenced {
  seq: number;
}

export interface GapFlush<T extends Sequenced> {
  missingSeq: number;
  ready: T[];
}

export class ReorderBuffer<T extends Sequenced> {
  private nextSeq: number;
  private readonly buffered = new Map<number, T>();
  private readonly heap = new MinHeap();
  private gapStartedAt: number | null = null;

  constructor(startSeq = 1, private readonly gapTimeoutMs = 3000) {
    this.nextSeq = startSeq;
  }

  get expectedSeq(): number {
    return this.nextSeq;
  }

  get size(): number {
    return this.buffered.size;
  }

  reset(startSeq = 1): void {
    this.nextSeq = startSeq;
    this.buffered.clear();
    this.heap.clear();
    this.gapStartedAt = null;
  }

  insert(message: T, now = Date.now()): T[] {
    if (message.seq < this.nextSeq) {
      return [];
    }

    if (message.seq === this.nextSeq) {
      this.nextSeq += 1;
      this.gapStartedAt = null;
      return [message, ...this.drainSequential()];
    }

    if (!this.buffered.has(message.seq)) {
      this.buffered.set(message.seq, message);
      this.heap.push(message.seq);
    }
    if (this.gapStartedAt === null) {
      this.gapStartedAt = now;
    }
    return [];
  }

  flushExpiredGap(now = Date.now()): GapFlush<T> | null {
    if (this.buffered.size === 0 || this.gapStartedAt === null) {
      return null;
    }
    if (now - this.gapStartedAt < this.gapTimeoutMs) {
      return null;
    }

    const missingSeq = this.nextSeq;
    this.nextSeq += 1;
    this.gapStartedAt = this.buffered.has(this.nextSeq) ? null : now;
    const ready = this.drainSequential();
    return { missingSeq, ready };
  }

  private drainSequential(): T[] {
    const ready: T[] = [];
    while (true) {
      this.discardStaleHeapHeads();
      const next = this.buffered.get(this.nextSeq);
      if (!next) break;
      this.buffered.delete(this.nextSeq);
      this.nextSeq += 1;
      ready.push(next);
    }
    if (this.buffered.size === 0) {
      this.gapStartedAt = null;
    }
    return ready;
  }

  private discardStaleHeapHeads(): void {
    while (this.heap.size > 0) {
      const head = this.heap.peek();
      if (head === undefined) return;
      if (head >= this.nextSeq && this.buffered.has(head)) return;
      this.heap.pop();
    }
  }
}
