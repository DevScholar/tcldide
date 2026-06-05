/**
 * eval — runTcl (sync) and runTclAsync (async) wrappers around
 * tcldide_eval. Mirrors Pyodide's runPython / runPythonAsync split.
 *
 * In the Worker, emscripten_sleep uses Atomics.wait (truly blocks the
 * thread), so tcldide_eval always returns synchronously — even when
 * the Tcl script calls vwait/tkwait. runTcl and runTclAsync are
 * currently equivalent; the async variant exists as a future hook for
 * when ASYNCIFY unwind is needed.
 */

import type { RuntimeBindings } from './launch.js';
import { TclError } from '../errors.js';

export interface EvalAPI {
  runTcl(code: string): string;
  runTclAsync(code: string): Promise<string>;
}

export function makeEval(bindings: RuntimeBindings): EvalAPI {
  const runTcl = (code: string): string => {
    const rc = bindings.c_eval(code) as number;
    const result = bindings.c_result();
    if (rc !== 0) throw new TclError(result);
    return result;
  };

  const runTclAsync = (code: string): Promise<string> =>
    Promise.resolve(runTcl(code));

  return { runTcl, runTclAsync };
}
