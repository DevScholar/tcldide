/**
 * eval — runTcl and runTclAsync wrappers around tcldide_eval.
 *
 * Two paths:
 *   makeEval   — Tk build:  c_eval is JSPI-wrapped (returns Promise).
 *                runTclAsync awaits it; runTcl uses a sync-XHR trampoline.
 *   makeEvalBase — Base build: c_eval is a plain sync export (returns
 *                number). runTcl calls it directly. c_eval_async is the
 *                JSPI-wrapped variant for runTclAsync.
 */

import { TclError } from '../errors.js';

export interface EvalAPI {
  runTcl(code: string): string;
  runTclAsync(code: string): Promise<string>;
}

/* ---- base build (sync c_eval + async c_eval_async) ---- */

export interface BaseEvalBindings {
  c_eval(code: string): number;
  c_eval_async(code: string): Promise<number>;
  c_result(): string;
}

export function makeEvalBase(bindings: BaseEvalBindings): EvalAPI {
  const runTclAsync = async (code: string): Promise<string> => {
    const rc = await bindings.c_eval_async(code);
    const result = bindings.c_result();
    if (rc !== 0) throw new TclError(result);
    return result;
  };

  const runTcl = (code: string): string => {
    const rc = bindings.c_eval(code);
    const result = bindings.c_result();
    if (rc !== 0) throw new TclError(result);
    return result;
  };

  return { runTcl, runTclAsync };
}

/* ---- Tk build (JSPI c_eval → sync-XHR trampoline for runTcl) ---- */

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

export interface TkEvalBindings {
  c_eval(code: string): Promise<number>;
  c_result(): Promise<string>;
}

export function makeEval(bindings: TkEvalBindings): EvalAPI {
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

    for (let spins = 0; !done && spins < 10000; spins++) {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'data:text/plain,', false);
        xhr.send();
      } catch {
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
