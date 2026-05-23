/**
 * eval — runTcl (sync) and runTclAsync (async) wrappers around
 * tcldide_eval. Translate the wasm's two return modes (sync number vs
 * suspending Promise) into the two user-facing entry shapes.
 *
 * Sync runTcl path:
 *   - Refuses to enter if the queue is busy (a previous async unwind
 *     is still in flight).
 *   - Calls c_eval; if the wasm yielded, the call returns a Promise.
 *     We can't resume that Promise sync-ly, so we park it on the
 *     queue's chain (so the next call doesn't race it) and throw a
 *     "use runTclAsync" error.
 *   - On sync success, drain idle handlers right away with one
 *     c_do_one_event (also potentially yielding — same parking trick).
 *
 * Async runTclAsync path:
 *   - Goes through queue.enqueue so it serialises with the event
 *     pump and other async evals.
 *   - Awaits c_eval (which may or may not actually yield) and
 *     c_do_one_event after.
 */

import type { AsyncifyQueue } from './asyncify-queue.js';
import type { RuntimeBindings } from './launch.js';
import { TclError } from '../errors.js';

export interface EvalAPI {
  runTcl(code: string): string;
  runTclAsync(code: string): Promise<string>;
}

export function makeEval(bindings: RuntimeBindings, queue: AsyncifyQueue): EvalAPI {
  const runTcl = (code: string): string => {
    if (queue.busy) {
      throw new Error(
        'tcldide: a previous async Tcl call has not finished unwinding ' +
        '(Asyncify supports one unwind at a time). Use runTclAsync(...) ' +
        'or await an in-flight runTclAsync before calling runTcl.',
      );
    }
    const rc = bindings.c_eval(code);
    if (rc instanceof Promise) {
      queue.park(rc);
      throw new Error(
        'tcldide: runTcl saw an async script (it called vwait/update). ' +
        'Use runTclAsync(...) instead.',
      );
    }
    const result = bindings.c_result();
    if (rc !== 0) throw new TclError(result);
    /* Drain pending idle handlers and paint events right away.
     * Without this, the result of a `pack` / `wm geometry` chain only
     * paints on the next requestAnimationFrame tick (~16ms later).
     * c_do_one_event is cwrap'd with {async:true} so it always returns
     * a Promise; park it so the drain doesn't race the next call. */
    queue.park(bindings.c_do_one_event());
    return result;
  };

  const runTclAsync = (code: string): Promise<string> =>
    queue.enqueue(async () => {
      const rc = await bindings.c_eval(code);
      const result = bindings.c_result();
      if (rc !== 0) throw new TclError(result);
      await bindings.c_do_one_event();
      return result;
    });

  return { runTcl, runTclAsync };
}
