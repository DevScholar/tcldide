/**
 * event-pump — drive Tk's event loop on requestAnimationFrame.
 *
 * Tk's notifier sleeps the wasm via emscripten_sleep when its event
 * queue runs dry; without something nudging it, timer/expose/input
 * events would only flow during user runTcl calls. This pump fires
 * every animation frame and drains pending events up to an 8ms wall
 * budget per tick.
 *
 * The pump enqueues onto the same AsyncifyQueue as user evals so it
 * never runs concurrently with one — it just fills the gaps. We
 * inline-await any Promise from c_do_one_event so a single tick can
 * keep draining events even when the notifier yielded; the older
 * "park promise on chain and exit" pattern degraded to one event per
 * frame whenever Tk yielded (which is most events) and stretched
 * widget realize/map to multiple seconds.
 */

import type { AsyncifyQueue } from './asyncify-queue.js';
import type { RuntimeBindings } from './launch.js';

const TICK_BUDGET_MS = 8;

export function startEventPump(
  bindings: RuntimeBindings,
  queue: AsyncifyQueue,
): void {
  const tick = (): void => {
    void queue.enqueue(async () => {
      const deadline = performance.now() + TICK_BUDGET_MS;
      while (true) {
        const n = await bindings.c_do_one_event();
        if (n === 0 || performance.now() >= deadline) return;
      }
    });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
