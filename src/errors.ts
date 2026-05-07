/**
 * TclError — thrown by runTcl/runTclAsync when the script returns
 * TCL_ERROR. Mirrors Pyodide's PythonError. Lives in its own module
 * so eval.ts and the public composer can both import it without a
 * cycle.
 */

export class TclError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TclError';
  }
}
