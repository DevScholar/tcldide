/**
 * globals — Pyodide-style namespace for Tcl global variables.
 * Reads/writes go through tcldide_get_var / tcldide_set_var; delete loops
 * back through Tcl's own `unset` since there's no direct C entry.
 */

export interface TcldideGlobals {
  get(name: string): Promise<string | undefined>;
  set(name: string, value: unknown): Promise<void>;
  has(name: string): Promise<boolean>;
  delete(name: string): Promise<void>;
}

interface GlobalsBindings {
  c_get_var(name: string): Promise<string | null>;
  c_set_var(name: string, value: string): Promise<string | null>;
}

export function makeGlobals(
  bindings: GlobalsBindings,
  runTcl: (code: string) => string,
): TcldideGlobals {
  return {
    async get(name) {
      const v = await bindings.c_get_var(name);
      return v == null ? undefined : v;
    },
    async set(name, value) {
      await bindings.c_set_var(name, String(value));
    },
    async has(name) {
      return (await bindings.c_get_var(name)) != null;
    },
    async delete(name) {
      runTcl(`unset -nocomplain ::${name}`);
    },
  };
}
