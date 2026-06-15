interface DedupEntry {
  seq: number;
  ts: number;
}

export class SlidingDedupWindow {
  private entries: DedupEntry[] = [];
  private head = 0;
  private readonly seqSet = new Set<number>();

  constructor(private readonly windowMs = 30_000) {}

  get size(): number {
    return this.seqSet.size;
  }

  reset(seqs: number[] = [], now = Date.now()): void {
    this.entries = [];
    this.head = 0;
    this.seqSet.clear();
    for (const seq of seqs) {
      this.add(seq, now);
    }
  }

  has(seq: number, now = Date.now()): boolean {
    this.evict(now);
    return this.seqSet.has(seq);
  }

  add(seq: number, now = Date.now()): boolean {
    this.evict(now);
    if (this.seqSet.has(seq)) {
      return false;
    }
    this.entries.push({ seq, ts: now });
    this.seqSet.add(seq);
    return true;
  }

  snapshot(limit = 100): number[] {
    const live = this.entries.slice(this.head).map((entry) => entry.seq);
    return live.slice(Math.max(0, live.length - limit));
  }

  private evict(now: number): void {
    while (this.head < this.entries.length && now - this.entries[this.head].ts > this.windowMs) {
      this.seqSet.delete(this.entries[this.head].seq);
      this.head += 1;
    }
    if (this.head > 512 && this.head * 2 > this.entries.length) {
      this.entries = this.entries.slice(this.head);
      this.head = 0;
    }
  }
}
