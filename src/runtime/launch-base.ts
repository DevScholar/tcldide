/**
 * launch-base — boot the tcldide-runtime-base wasm (Tcl-only, no em-x11).
 *
 * Uses the Emscripten factory directly (no child_process.spawn). The wasm
 * exports a sync tcldide_eval (not JSPI-wrapped) so runTcl returns without
 * Promise trampolining, and tcldide_eval_async (JSPI-wrapped) for
 * runTclAsync which can suspend across vwait / blocking after.
 */

export interface LaunchBaseConfig {
  indexURL?: string;
  glueURL?: string;
  wasmURL?: string;
  stdout: (m: string) => void;
  stderr: (m: string) => void;
}

export interface RuntimeBindings {
  /** Sync eval — NOT JSPI-wrapped, returns number directly. */
  c_eval(code: string): number;
  /** Async eval — JSPI-wrapped, can suspend. */
  c_eval_async(code: string): Promise<number>;
  /** Result of last eval (sync, not JSPI-wrapped). */
  c_result(): string;
  c_get_var(name: string): Promise<string | null>;
  c_set_var(name: string, value: string): Promise<string | null>;
}

export interface LaunchBaseResult {
  module: Record<string, unknown>;
  bindings: RuntimeBindings;
  tclVersion: string;
}

interface CwrapModule {
  cwrap: (
    name: string,
    returnType: string | null,
    argTypes: string[],
    opts?: { async?: boolean },
  ) => (...args: unknown[]) => unknown;
}

export async function launchRuntimeBase(config: LaunchBaseConfig): Promise<LaunchBaseResult> {
  const indexURL = (config.indexURL ?? '/build/artifacts/tcldide-runtime-base').replace(/\/+$/, '');
  const glueURL  = config.glueURL  ?? `${indexURL}/tcldide-runtime-base.js`;
  const wasmURL  = config.wasmURL  ?? `${indexURL}/tcldide-runtime-base.wasm`;

  const factory = (await import(/* @vite-ignore */ glueURL)).default;
  const module = await factory({
    print:    (line: string) => config.stdout(line),
    printErr: (line: string) => config.stderr(line),
    locateFile: (path: string) => path.endsWith('.wasm') ? wasmURL : path,
  });

  const cwrapMod = module as unknown as CwrapModule;
  const bindings: RuntimeBindings = {
    c_eval:       cwrapMod.cwrap('tcldide_eval',       'number', ['string'],             { async: false }) as RuntimeBindings['c_eval'],
    c_eval_async: cwrapMod.cwrap('tcldide_eval_async', 'number', ['string'],             { async: true  }) as RuntimeBindings['c_eval_async'],
    c_result:     cwrapMod.cwrap('tcldide_result',     'string', []),
    c_get_var:    cwrapMod.cwrap('tcldide_get_var',    'string', ['string'],             { async: true  }) as RuntimeBindings['c_get_var'],
    c_set_var:    cwrapMod.cwrap('tcldide_set_var',    'string', ['string', 'string'],   { async: true  }) as RuntimeBindings['c_set_var'],
  };

  const tclVersion = (await bindings.c_get_var('tcl_version')) ?? '';

  return { module: module as Record<string, unknown>, bindings, tclVersion };
}
