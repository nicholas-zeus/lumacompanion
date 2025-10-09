// /js/progress.js
// Aggregate-progress helper for multi-part uploads/downloads.
// Call `progress.addTotal(bytes)` once you know all sizes (or incrementally).
// Then call `progress.tick(deltaBytes)` as each chunk completes,
// and use `progress.percent()` to update your overlay bar.

export class Progress {
  constructor() {
    this.total = 0;
    this.done = 0;
    this.listeners = new Set();
  }

  addTotal(bytes) {
    this.total += Math.max(0, Number(bytes) || 0);
    this.emit();
  }

  tick(deltaBytes) {
    this.done += Math.max(0, Number(deltaBytes) || 0);
    if (this.done > this.total) this.done = this.total;
    this.emit();
  }

  set(doneBytes, totalBytes) {
    this.done = Math.max(0, Number(doneBytes) || 0);
    this.total = Math.max(0, Number(totalBytes) || 0);
    this.emit();
  }

  percent() {
    if (this.total <= 0) return 0;
    return Math.max(0, Math.min(100, (this.done / this.total) * 100));
  }

  onChange(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  emit() { const p = this.percent(); this.listeners.forEach(fn => fn(p, this)); }
}
