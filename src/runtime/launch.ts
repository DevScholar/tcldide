/**
 * launch — boot the wacl-tk-runtime wasm under em-x11 and bind the
 * cwrap entry points the rest of the runtime modules call.
 *
 * Each binding is typed `T | Promise<T>`: ASYNCIFY-enabled wasm exports
 * return a sync value when the call doesn't suspend and a Promise when
 * it does. The async-queue layer (asyncify-queue.ts) decides what to
 * do with that distinction; we just type it honestly here.
 */

import { createEmX11, type EmX11 } from '../../../em-x11/src/index.js';
import type { EmscriptenModule } from '../../../em-x11/src/types/emscripten.js';

export interface LaunchConfig {
  indexURL?: string;
  glueURL?: string;
  wasmURL?: string;
  canvas?: HTMLCanvasElement;
  width?: number;
  height?: number;
  /** Closure-bound stdout/stderr the caller can swap later via
   *  setStdout/setStderr without restarting the runtime. We pass
   *  thunks into createEmX11 so the swap takes effect on the next
   *  print. */
  stdout: (m: string) => void;
  stderr: (m: string) => void;
}

export interface RuntimeBindings {
  c_eval(code: string): number | Promise<number>;
  c_result(): string;
  c_get_var(name: string): string | null;
  c_set_var(name: string, value: string): string | null;
  c_do_one_event(): number | Promise<number>;
}

export interface LaunchResult {
  em: EmX11;
  module: EmscriptenModule;
  bindings: RuntimeBindings;
  /** tcl_version global, e.g. "8.6". */
  tclVersion: string;
  /** tk_version global, e.g. "8.6". */
  tkVersion: string;
}

interface CwrapModule {
  cwrap: (
    name: string,
    returnType: string | null,
    argTypes: string[],
  ) => (...args: unknown[]) => unknown;
}

export async function launchRuntime(config: LaunchConfig): Promise<LaunchResult> {
  const indexURL = (config.indexURL ?? '/build/artifacts/wacl-tk-runtime').replace(/\/+$/, '');
  const glueURL  = config.glueURL  ?? `${indexURL}/wacl-tk-runtime.js`;
  const wasmURL  = config.wasmURL  ?? `${indexURL}/wacl-tk-runtime.wasm`;

  const em = await createEmX11({
    canvas: config.canvas,
    width: config.width,
    height: config.height,
    stdout: config.stdout,
    stderr: config.stderr,
  });

  const proc = em.spawn(glueURL, { wasmUrl: wasmURL });
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
   * See wacl-tk-runtime.c::wacl_push_key_text for the full rationale.
   * The compatibility layer goes away when we move to Tcl/Tk 9.x. */
  const m = module as unknown as Record<string, unknown>;
  if (typeof m._wacl_push_key_text === 'function') {
    m._emx11_set_pending_key_text = m._wacl_push_key_text;
  }

  const cwrap = (module as EmscriptenModule & CwrapModule).cwrap;
  const bindings: RuntimeBindings = {
    c_eval:         cwrap('wacl_eval',         'number', ['string']) as RuntimeBindings['c_eval'],
    c_result:       cwrap('wacl_result',       'string', [])         as RuntimeBindings['c_result'],
    c_get_var:      cwrap('wacl_get_var',      'string', ['string']) as RuntimeBindings['c_get_var'],
    c_set_var:      cwrap('wacl_set_var',      'string', ['string', 'string']) as RuntimeBindings['c_set_var'],
    c_do_one_event: cwrap('wacl_do_one_event', 'number', [])         as RuntimeBindings['c_do_one_event'],
  };

  return {
    em,
    module,
    bindings,
    tclVersion: bindings.c_get_var('tcl_version') ?? '',
    tkVersion:  bindings.c_get_var('tk_version')  ?? '',
  };
}
