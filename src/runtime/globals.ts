/**
 * globals — Pyodide-style namespace for Tcl global variables.
 * Reads/writes go through tcldide_get_var / tcldide_set_var; delete loops
 * back through Tcl's own `unset` since there's no direct C entry.
 */

export interface TcldideGlobals {
  get(name: string): string | undefined;
  set(name: string, value: unknown): void;
  has(name: string): boolean;
  delete(name: string): void;
}

interface GlobalsBindings {
  c_get_var(name: string): string | null;
  c_set_var(name: string, value: string): string | null;
}

export function makeGlobals(
  bindings: GlobalsBindings,
  runTcl: (code: string) => string,
): TcldideGlobals {
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
      runTcl(`unset -nocomplain ::${name}`);
    },
  };
}
