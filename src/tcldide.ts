/**
 * tcldide: Pyodide-style JavaScript API for the Tcl/Tk WebAssembly
 * runtime. Mirrors the loadPyodide() shape so users coming from
 * Pyodide can pick this up without re-learning anything.
 *
 *   import { loadTcldide } from './tcldide.js';
 *
 *   const tcldide = await loadTcldide();
 *   tcldide.runTcl(`
 *     button .b -text Click -command { incr ::n }
 *     pack .b
 *   `);
 *   console.log(tcldide.globals.get('tcl_version'));
 *
 * The runtime under the hood is a single wasm built from runtime/
 * (`tcldide-runtime.{js,wasm,data}`) that links Tcl, Tk, and em-x11
 * statically. createEmX11 wires up the host facade on
 * `globalThis.emX11` and paints Tk's X11 calls into a <canvas>. By
 * default we create that canvas inside document.body; the host page
 * can attach an existing one with the `canvas` option (Pyodide's
 * `setCanvas2D` analog).
 *
 * This file is the public entry: it re-exports the user-facing types
 * and composes the small runtime modules under src/runtime/. Each
 * subsystem (boot, asyncify queue, event pump, eval, globals, canvas)
 * lives in its own file there so they stay independently legible and
 * testable.
 */

import type { EmX11 } from '../../em-x11/src/index.js';
import type { EmscriptenModule } from '../../em-x11/src/types/emscripten.js';

import { TclError } from './errors.js';
import { launchRuntime } from './runtime/launch.js';
import { AsyncifyQueue } from './runtime/asyncify-queue.js';
import { makeEval } from './runtime/eval.js';
import { makeGlobals, type TcldideGlobals } from './runtime/globals.js';
import { makeCanvas, type TcldideCanvas } from './runtime/canvas.js';

export { TclError } from './errors.js';
export type { TcldideGlobals } from './runtime/globals.js';
export type { TcldideCanvas } from './runtime/canvas.js';

/* ---------------- Public types ---------------- */

export interface TcldideConfig {
  /** Base URL where tcldide-runtime.{js,wasm,data} live. Default:
   *  `/build/artifacts/tcldide-runtime`. */
  indexURL?: string;
  /** Override the URL of the .js glue. Default: `${indexURL}/tcldide-runtime.js`. */
  glueURL?: string;
  /** Override the URL of the .wasm. Default: `${indexURL}/tcldide-runtime.wasm`. */
  wasmURL?: string;
  /** Existing <canvas> for Tk to paint into. If omitted, a 1024x768
   *  canvas is created and appended to document.body. */
  canvas?: HTMLCanvasElement;
  /** Logical width/height when creating a canvas. Ignored when `canvas`
   *  is provided (its current size is used). */
  width?: number;
  height?: number;
  /** Override the standard output callback. Same semantics as
   *  Pyodide's stdout option: receives one full line per call. */
  stdout?: (msg: string) => void;
  /** Override the standard error callback. */
  stderr?: (msg: string) => void;
}

export interface TcldideAPI {
  /** Tcl runtime version (e.g. `"8.6"`). */
  readonly version: string;
  /** Tk runtime version (e.g. `"8.6"`). */
  readonly tkVersion: string;
  /** Emscripten FS object (the in-memory filesystem). */
  readonly FS: typeof FS;
  /** The em-x11 instance driving Tk's X11 calls. Advanced use. */
  readonly em: EmX11;
  /** Raw Emscripten module. Advanced use. */
  readonly module: EmscriptenModule;

  /** Run a Tcl script synchronously. Returns the script's result as a
   *  string. Throws {@link TclError} on TCL_ERROR.
   *
   *  Scripts that call `vwait`, `tkwait`, or `update` will cause the
   *  wasm to suspend — in that case this throws and you should use
   *  {@link runTclAsync} instead. */
  runTcl(code: string): string;

  /** Run a Tcl script while pumping the Tk event loop in the background.
   *  Use this for scripts that call `vwait`, `tkwait`, or `update`. */
  runTclAsync(code: string): Promise<string>;

  /** Tcl global namespace, mirroring `pyodide.globals`. */
  readonly globals: TcldideGlobals;

  /** Canvas plumbing, mirroring `pyodide.canvas`. */
  readonly canvas: TcldideCanvas;

  /** Override stdout. */
  setStdout(opts: { batched: (msg: string) => void }): void;
  /** Override stderr. */
  setStderr(opts: { batched: (msg: string) => void }): void;
}

/* ---------------- Composer ---------------- */

export async function loadTcldide(config: TcldideConfig = {}): Promise<TcldideAPI> {
  /* Mutable slots so setStdout/setStderr can swap them after launch.
   * launchRuntime passes thunks into createEmX11 that read these via
   * closures, so reassignment takes effect on the next print. */
  let stdoutCb = config.stdout ?? ((m: string) => console.log(m));
  let stderrCb = config.stderr ?? ((m: string) => console.error(m));

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
  const { em, module, bindings, tclVersion, tkVersion } = await launchRuntime(launchConfig);

  const queue = new AsyncifyQueue();

  const { runTcl, runTclAsync } = makeEval(bindings, queue);
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
