export class MinHeap {
  private values: number[] = [];

  get size(): number {
    return this.values.length;
  }

  peek(): number | undefined {
    return this.values[0];
  }

  push(value: number): void {
    this.values.push(value);
    this.bubbleUp(this.values.length - 1);
  }

  pop(): number | undefined {
    if (this.values.length === 0) return undefined;
    const root = this.values[0];
    const tail = this.values.pop();
    if (tail !== undefined && this.values.length > 0) {
      this.values[0] = tail;
      this.sinkDown(0);
    }
    return root;
  }

  clear(): void {
    this.values = [];
  }

  private bubbleUp(index: number): void {
    let current = index;
    while (current > 0) {
      const parent = Math.floor((current - 1) / 2);
      if (this.values[parent] <= this.values[current]) break;
      this.swap(parent, current);
      current = parent;
    }
  }

  private sinkDown(index: number): void {
    let current = index;
    while (true) {
      const left = current * 2 + 1;
      const right = current * 2 + 2;
      let smallest = current;

      if (left < this.values.length && this.values[left] < this.values[smallest]) {
        smallest = left;
      }
      if (right < this.values.length && this.values[right] < this.values[smallest]) {
        smallest = right;
      }
      if (smallest === current) break;
      this.swap(current, smallest);
      current = smallest;
    }
  }

  private swap(a: number, b: number): void {
    const tmp = this.values[a];
    this.values[a] = this.values[b];
    this.values[b] = tmp;
  }
}
