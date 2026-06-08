/**
 * eval — runTcl and runTclAsync wrappers around tcldide_eval.
 * Mirrors Pyodide's runPython / runPythonAsync split.
 *
 * With JSPI, all wasm exports are wrapped with WebAssembly.promising
 * and return Promises. runTclAsync is the native async entry point.
 *
 * runTcl pretends to be synchronous by wrapping runTclAsync with a
 * synchronous XMLHttpRequest to a data: URL. The theory: sync XHR
 * yields to the browser's event loop, allowing the microtask queue
 * to drain so the JSPI Promise can resolve. In practice this works
 * in Firefox but NOT in V8 (Chrome/Edge) where sync XHR does not
 * drain microtasks. Use runTclAsync for reliable behaviour.
 */

import type { RuntimeBindings } from './launch.js';
import { TclError } from '../errors.js';

export interface EvalAPI {
  /** Synchronous facade — wraps runTclAsync with a sync-XHR trampoline.
   *  Only reliable in Firefox; in V8-based browsers this will hang
   *  because sync XHR doesn't drain the microtask queue. */
  runTcl(code: string): string;
  /** JSPI-native async entry point. Prefer this for cross-browser
   *  reliability. */
  runTclAsync(code: string): Promise<string>;
}

const _syncXhrSupported = (() => {
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', 'data:text/plain,', false);
    xhr.send();
    return true;
  } catch {
    return false;
  }
})();

export function makeEval(bindings: RuntimeBindings): EvalAPI {
  const runTclAsync = async (code: string): Promise<string> => {
    const rc = await bindings.c_eval(code);
    const result = await bindings.c_result();
    if (rc !== 0) throw new TclError(result);
    return result;
  };

  const runTcl = (code: string): string => {
    if (!_syncXhrSupported) {
      throw new Error(
        'runTcl: synchronous mode not available in this browser. ' +
        'Use runTclAsync instead.',
      );
    }

    let result: string;
    let error: unknown;
    let done = false;

    runTclAsync(code).then(
      (r) => { result = r; done = true; },
      (e) => { error = e; done = true; },
    );

    /* Synchronous XHR to a data: URL. The theory is that some browser
     * engines (Firefox) drain the microtask queue during the sync
     * fetch, allowing the JSPI Promise chain above to resolve. This
     * is NOT standards-mandated behaviour — the HTML spec says sync
     * XHR should not run microtasks — but Firefox's implementation
     * happens to do so. V8 (Chrome/Edge) does not, so the loop has a
     * hard cap that throws a clear error. */
    for (let spins = 0; !done && spins < 10000; spins++) {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'data:text/plain,', false);
        xhr.send();
      } catch {
        /* Sync XHR blocked entirely (e.g. Worker without access). */
        break;
      }
    }

    if (!done) {
      throw new Error(
        'runTcl: synchronous wrapper did not resolve. ' +
        'This browser does not drain the microtask queue during ' +
        'sync XHR (Chrome/Edge). Use runTclAsync instead.',
      );
    }
    if (error) throw error;
    return result!;
  };

  return { runTcl, runTclAsync };
}
