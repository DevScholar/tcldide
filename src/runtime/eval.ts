/**
 * eval — runTcl (sync) and runTclAsync (async) wrappers around
 * tcldide_eval. Mirrors Pyodide's runPython / runPythonAsync split.
 *
 * Sync runTcl:
 *   - Refuses to enter if the queue is busy (a previous async unwind
 *     is still in flight).
 *   - Calls c_eval; if the wasm yielded, the call returns a Promise.
 *     We park it on the queue's chain (so the next call doesn't race
 *     it) and throw a "use runTclAsync" error.
 *   - On sync success, the post-eval drain runs inside tcldide_eval
 *     on the C side (idle/expose handlers fire before returning so
 *     widgets paint immediately).
 *
 * Async runTclAsync:
 *   - Goes through queue.enqueue so it serialises with the event
 *     pump and other async evals.
 *   - Awaits c_eval (which may or may not yield).
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
    return result;
  };

  const runTclAsync = (code: string): Promise<string> =>
    queue.enqueue(async () => {
      const rc = await bindings.c_eval(code);
      const result = bindings.c_result();
      if (rc !== 0) throw new TclError(result);
      return result;
    });

  return { runTcl, runTclAsync };
}
