/**
 * eval — runTcl and runTclAsync wrappers around tcldide_eval.
 *
 * With ASYNCIFY enabled, tcldide_eval may return a number (sync success,
 * no suspend) or a Promise<number> (wasm suspended in emscripten_sleep
 * because the script called vwait/tkwait/update).  Both paths go through
 * the AsyncifyQueue so only one unwind is in flight at a time.
 *
 * The post-eval drain (idle/expose handlers) runs inside tcldide_eval on
 * the C side, so widgets appear immediately without waiting for the next
 * rAF tick.
 */

import type { AsyncifyQueue } from './asyncify-queue.js';
import type { RuntimeBindings } from './launch.js';
import { TclError } from '../errors.js';

export interface EvalAPI {
  runTcl(code: string): Promise<string>;
  runTclAsync(code: string): Promise<string>;
}

export function makeEval(bindings: RuntimeBindings, queue: AsyncifyQueue): EvalAPI {
  const runTcl = (code: string): Promise<string> =>
    queue.enqueue(async () => {
      const rc = await bindings.c_eval(code);
      const result = bindings.c_result();
      if (rc !== 0) throw new TclError(result);
      return result;
    });

  const runTclAsync = (code: string): Promise<string> => runTcl(code);

  return { runTcl, runTclAsync };
}
