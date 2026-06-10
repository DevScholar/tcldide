/**
 * launch-tk — boot the tcldide-runtime-tk wasm under em-x11.
 *
 * em-x11 is dynamically imported so the JS host (canvas, compositor,
 * input handlers, IME) is only fetched when Tk mode is requested.
 *
 * With JSPI, wasm exports that may suspend (emscripten_sleep) return
 * Promises. The loadWasm post-processing wraps every '_'-prefixed export
 * with WebAssembly.promising, so all cwrap-based calls now return
 * Promises. Callers must await.
 */

import type { EmX11 } from '../../../em-x11/src/index.js';
import type { EmscriptenModule } from '../../../em-x11/src/types/emscripten.js';

export interface LaunchConfig {
  indexURL?: string;
  glueURL?: string;
  wasmURL?: string;
  canvas?: HTMLCanvasElement;
  width?: number;
  height?: number;
  stdout: (m: string) => void;
  stderr: (m: string) => void;
}

export interface RuntimeBindings {
  c_eval(code: string): Promise<number>;
  c_result(): Promise<string>;
  c_get_var(name: string): string | null;
  c_set_var(name: string, value: string): string | null;
}

export interface LaunchResult {
  em: EmX11;
  module: EmscriptenModule;
  bindings: RuntimeBindings;
  tclVersion: string;
  tkVersion: string;
}

interface CwrapModule {
  cwrap: (
    name: string,
    returnType: string | null,
    argTypes: string[],
    opts?: { async?: boolean },
  ) => (...args: unknown[]) => unknown;
}

export async function launchRuntimeTk(config: LaunchConfig): Promise<LaunchResult> {
  // Dynamic import — em-x11 JS is only fetched when Tk mode is requested
  const { createEmX11 } = await import('../../../em-x11/src/index.js');

  const indexURL = (config.indexURL ?? '/build/artifacts/tcldide-runtime-tk').replace(/\/+$/, '');
  const glueURL  = config.glueURL  ?? `${indexURL}/tcldide-runtime-tk.js`;
  const wasmURL  = config.wasmURL  ?? `${indexURL}/tcldide-runtime-tk.wasm`;

  const em = await createEmX11({
    canvas: config.canvas,
    width: config.width,
    height: config.height,
    stdout: config.stdout,
    stderr: config.stderr,
  });

  const proc = em.child_process.spawn(glueURL, { wasmUrl: wasmURL });
  await proc.ready;
  const module = await proc.module;

  /* NOT an XIM bypass -- this hook sits ON the standard XIM ingress
   * path. emx11_set_pending_key_text -> Xutf8LookupString is the
   * real protocol path; we only insert a UTF-8 -> CESU-8 transcode
   * in front of it because Tcl 8.6 (TCL_UTF_MAX=3) stores text as
   * CESU-8 surrogate pairs, and stock Tk's tkUnixKey.c TkpGetString
   * zero-converts XIM bytes -- so a 4-byte emoji from XIM lands in
   * Tk text storage with wrong stride, blowing up on backspace.
   *
   * See tcldide-runtime.c::tcldide_push_key_text for the full rationale.
   * The compatibility layer goes away when we move to Tcl/Tk 9.x. */
  const m = module as unknown as Record<string, unknown>;
  if (typeof m._tcldide_push_key_text === 'function') {
    m._emx11_set_pending_key_text = m._tcldide_push_key_text;
  }

  const cwrap = (module as EmscriptenModule & CwrapModule).cwrap;
  const bindings: RuntimeBindings = {
    c_eval:    cwrap('tcldide_eval',    'number', ['string'],             { async: true }) as RuntimeBindings['c_eval'],
    c_result:  cwrap('tcldide_result',  'string', []),
    c_get_var: cwrap('tcldide_get_var', 'string', ['string'],             { async: false }) as RuntimeBindings['c_get_var'],
    c_set_var: cwrap('tcldide_set_var', 'string', ['string', 'string'],   { async: false }) as RuntimeBindings['c_set_var'],
  };

  const tclVersion = bindings.c_get_var('tcl_version') ?? '';
  const tkVersion  = bindings.c_get_var('tk_version')  ?? '';

  return {
    em,
    module,
    bindings,
    tclVersion,
    tkVersion,
  };
}
