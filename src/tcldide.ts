/**
 * tcldide: Pyodide-style JavaScript API for the Tcl/Tk WebAssembly
 * runtime. Mirrors the loadPyodide() shape so users coming from
 * Pyodide can pick this up without re-learning anything.
 *
 *   import { loadTcldide } from './tcldide.js';
 *
 *   // Tcl-only (no GUI, no em-x11):
 *   const tcldide = await loadTcldide();
 *
 *   // Tcl + Tk (with em-x11 canvas):
 *   const tcldide = await loadTcldide({ tk: true });
 *   tcldide.runTcl(`
 *     button .b -text Click -command { incr ::n }
 *     pack .b
 *   `);
 *   console.log(tcldide.globals.get('tcl_version'));
 *
 * Two wasm builds back the API:
 *   tcldide-runtime-base.wasm — Tcl only (libtcl8.6.a, no em-x11)
 *   tcldide-runtime-tk.wasm   — Tcl + Tk + em-x11 (full GUI stack)
 *
 * em-x11 JS is dynamically imported only when { tk: true } so Tcl-only
 * consumers never fetch the canvas/compositor/input bundle.
 */

import type { EmX11 } from '../../em-x11/src/index.js';
import type { EmscriptenModule } from '../../em-x11/src/types/emscripten.js';

import { TclError } from './errors.js';
import { makeEval, makeEvalBase } from './runtime/eval.js';
import { makeGlobals, type TcldideGlobals } from './runtime/globals.js';
import { makeCanvas, type TcldideCanvas } from './runtime/canvas.js';

export { TclError } from './errors.js';
export type { TcldideGlobals } from './runtime/globals.js';
export type { TcldideCanvas } from './runtime/canvas.js';

/* ---------------- Public types ---------------- */

export interface TcldideConfig {
  /** Enable Tk (and em-x11). Default: false. When true, the em-x11 JS
   *  host (canvas, compositor, input) is dynamically imported and the
   *  Tk-enabled wasm is loaded. canvas/width/height only apply when
   *  tk is true. */
  tk?: boolean;
  /** Base URL where tcldide-runtime.{js,wasm,data} live. Default varies
   *  by mode:
   *    base: /build/artifacts/tcldide-runtime-base
   *    tk:   /build/artifacts/tcldide-runtime-tk */
  indexURL?: string;
  /** Override the URL of the .js glue. */
  glueURL?: string;
  /** Override the URL of the .wasm. */
  wasmURL?: string;
  /** Existing <canvas> for Tk to paint into. Only meaningful with {tk:true}. */
  canvas?: HTMLCanvasElement;
  /** Logical width/height when creating a canvas. Only meaningful with {tk:true}. */
  width?: number;
  height?: number;
  /** Override the standard output callback. */
  stdout?: (msg: string) => void;
  /** Override the standard error callback. */
  stderr?: (msg: string) => void;
}

export interface TcldideAPI {
  /** Tcl runtime version (e.g. `"8.6"`). Always present. */
  readonly version: string;
  /** Tk runtime version (e.g. `"8.6"`). Undefined in base mode. */
  readonly tkVersion?: string;
  /** Emscripten FS object (the in-memory filesystem). */
  readonly FS: typeof FS;
  /** The em-x11 instance driving Tk's X11 calls. Undefined in base mode. */
  readonly em?: EmX11;
  /** Raw Emscripten module. */
  readonly module: EmscriptenModule | Record<string, unknown>;

  /** Run a Tcl script synchronously. See runTclAsync for reliability. */
  runTcl(code: string): string;
  /** Run a Tcl script asynchronously. JSPI-native, works in all browsers. */
  runTclAsync(code: string): Promise<string>;

  /** Tcl global namespace, mirroring `pyodide.globals`. */
  readonly globals: TcldideGlobals;
  /** Canvas plumbing. Undefined in base mode. */
  readonly canvas?: TcldideCanvas;

  /** Override stdout. */
  setStdout(opts: { batched: (msg: string) => void }): void;
  /** Override stderr. */
  setStderr(opts: { batched: (msg: string) => void }): void;
}

/* ---------------- Composer ---------------- */

export async function loadTcldide(config: TcldideConfig = {}): Promise<TcldideAPI> {
  let stdoutCb = config.stdout ?? ((m: string) => console.log(m));
  let stderrCb = config.stderr ?? ((m: string) => console.error(m));

  if (config.tk) {
    // Dynamic import — em-x11 JS only fetched here
    const { launchRuntimeTk } = await import('./runtime/launch-tk.js');

    const launchConfig = {
      stdout: (m: string) => stdoutCb(m),
      stderr: (m: string) => stderrCb(m),
      ...(config.indexURL !== undefined ? { indexURL: config.indexURL } : {}),
      ...(config.glueURL  !== undefined ? { glueURL:  config.glueURL  } : {}),
      ...(config.wasmURL  !== undefined ? { wasmURL:  config.wasmURL  } : {}),
      ...(config.canvas   !== undefined ? { canvas:   config.canvas   } : {}),
      ...(config.width    !== undefined ? { width:    config.width    } : {}),
      ...(config.height   !== undefined ? { height:   config.height   } : {}),
    };
    const { em, module, bindings, tclVersion, tkVersion } = await launchRuntimeTk(launchConfig);

    const { runTcl, runTclAsync } = makeEval(bindings);
    const globals = makeGlobals(bindings, runTcl);
    const canvas  = makeCanvas(em);

    return {
      version: tclVersion,
      tkVersion,
      FS: (module as unknown as { FS: typeof FS }).FS,
      em,
      module,
      runTcl,
      runTclAsync,
      globals,
      canvas,
      setStdout: (opts) => { stdoutCb = opts.batched; },
      setStderr: (opts) => { stderrCb = opts.batched; },
    };
  }

  // Tcl-only path — no em-x11, no dynamic import of the Tk launcher
  const { launchRuntimeBase } = await import('./runtime/launch-base.js');

  const launchConfig = {
    stdout: (m: string) => stdoutCb(m),
    stderr: (m: string) => stderrCb(m),
    ...(config.indexURL !== undefined ? { indexURL: config.indexURL } : {}),
    ...(config.glueURL  !== undefined ? { glueURL:  config.glueURL  } : {}),
    ...(config.wasmURL  !== undefined ? { wasmURL:  config.wasmURL  } : {}),
  };
  const { module, bindings, tclVersion } = await launchRuntimeBase(launchConfig);

  const { runTcl, runTclAsync } = makeEvalBase(bindings);
  const globals = makeGlobals(bindings, runTcl);

  return {
    version: tclVersion,
    FS: (module as unknown as { FS: typeof FS }).FS,
    module,
    runTcl,
    runTclAsync,
    globals,
    setStdout: (opts) => { stdoutCb = opts.batched; },
    setStderr: (opts) => { stderrCb = opts.batched; },
  };
}
