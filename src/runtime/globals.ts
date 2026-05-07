/**
 * globals — Pyodide-style namespace for Tcl global variables.
 * Reads/writes go through wacl_get_var / wacl_set_var; delete loops
 * back through Tcl's own `unset` since there's no direct C entry.
 */

import type { RuntimeBindings } from './launch.js';

export interface WaclTkGlobals {
  get(name: string): string | undefined;
  set(name: string, value: unknown): void;
  has(name: string): boolean;
  delete(name: string): void;
}

export function makeGlobals(
  bindings: RuntimeBindings,
  runTcl: (code: string) => string,
): WaclTkGlobals {
  return {
    get(name) {
      const v = bindings.c_get_var(name);
      return v == null ? undefined : v;
    },
    set(name, value) {
      bindings.c_set_var(name, String(value));
    },
    has(name) {
      return bindings.c_get_var(name) != null;
    },
    delete(name) {
      void runTcl(`unset -nocomplain ::${name}`);
    },
  };
}
