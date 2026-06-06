/**
 * CallQueue — serialise calls into a JSPI-enabled wasm.
 *
 * JSPI does not have Asyncify's single-slot stack-snapshot limitation,
 * so concurrent suspending calls are safe in principle. However, the
 * Tcl interpreter is single-threaded and not re-entrant, so we still
 * serialise entry to prevent overlapping eval/event-pump calls from
 * corrupting interpreter state.
 *
 *   - `enqueue(fn)` runs `fn` after every previously enqueued task
 *     resolves, and returns a Promise for the result.
 *   - `busy` is true while a queued task is mid-await.
 *   - `park(promise)` parks an out-of-band Promise on the chain so
 *     subsequent enqueue()s wait for it.
 */

export class CallQueue {
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
