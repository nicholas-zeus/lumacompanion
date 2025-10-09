// /js/semaphore.js
// Minimal concurrency control for fetch/render pipelines.
// Usage:
//   const sem = new Semaphore(2);
//   await sem.run(() => fetchPart(...));
// or
//   const results = await mapWithConcurrency(items, 2, async (x) => ...);

export class Semaphore {
  constructor(max = 2) {
    if (!(max > 0)) throw new Error("Semaphore max must be > 0");
    this.max = max;
    this.active = 0;
    this.queue = [];
  }

  acquire() {
    return new Promise((resolve) => {
      const tryAcquire = () => {
        if (this.active < this.max) {
          this.active += 1;
          resolve(() => this.release());
        } else {
          this.queue.push(tryAcquire);
        }
      };
      tryAcquire();
    });
  }

  release() {
    this.active = Math.max(0, this.active - 1);
    const next = this.queue.shift();
    if (next) next();
  }

  async run(fn) {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export async function mapWithConcurrency(items, limit, iteratee) {
  const sem = new Semaphore(limit);
  const out = new Array(items.length);
  await Promise.all(
    items.map((item, idx) =>
      sem.run(async () => {
        out[idx] = await iteratee(item, idx);
      })
    )
  );
  return out;
}
