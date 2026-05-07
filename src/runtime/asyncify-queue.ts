/**
 * AsyncifyQueue — serialise calls into an Asyncify-enabled wasm.
 *
 * Asyncify saves the wasm stack into a single global slot during an
 * unwind, so two suspending calls can't be in flight at once: the
 * second would overwrite the first's snapshot. This queue runs every
 * suspending call through a single-slot Promise chain so unwinds
 * happen one at a time.
 *
 *   - `enqueue(fn)` runs `fn` after every previously enqueued task
 *     resolves, and returns a Promise for the result.
 *   - `busy` is true while a queued task is mid-await. Sync entry
 *     points (runTcl) check this and bail rather than re-entering
 *     wasm and trampling the saved stack.
 *   - `park(promise)` parks an out-of-band Promise on the chain so
 *     subsequent enqueue()s wait for it. Used when the sync runTcl
 *     path detects c_eval went async — we can't resume the unwind
 *     synchronously, but we can ensure the next call doesn't race it.
 */

export class AsyncifyQueue {
  private chain: Promise<unknown> = Promise.resolve();
  private _busy = false;

  get busy(): boolean {
    return this._busy;
  }

  enqueue<T>(fn: () => T | Promise<T>): Promise<T> {
    const next = this.chain.then(async () => {
      this._busy = true;
      try {
        return await fn();
      } finally {
        this._busy = false;
      }
    });
    this.chain = next.catch(() => undefined);
    return next;
  }

  park(promise: Promise<unknown>): void {
    this.chain = this.chain.then(() => promise).catch(() => undefined);
  }
}
