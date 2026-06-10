# tcldide JavaScript API

The tcldide JavaScript API mirrors [Pyodide][pyodide] so users coming
from Pyodide can pick it up without re-learning anything: replace
`loadPyodide` with `loadTcldide` and `runPython` with `runTcl`. The
shape, error semantics, and lifecycle are intentionally identical
where the languages allow.

This page documents the **most common** entry points (`loadTcldide`,
`runTcl`, `runTclAsync`, `globals`, `canvas`, `setStdout`/`setStderr`,
`FS`, `version`). Less-common surface area (foreign function interface,
`pyimport`, lockfiles, package loading) is not yet implemented.

[pyodide]: https://pyodide.org/en/stable/usage/api/js-api.html

---

## Top-level

### `loadTcldide(config?) → Promise<TcldideAPI>`

Boot the runtime. Two modes:

- **Tcl-only** (`loadTcldide()`) — loads `tcldide-runtime-base.{js,wasm}`,
  lightweight, no GUI. Good for scripting and testing.
- **Tk mode** (`loadTcldide({ tk: true })`) — loads `tcldide-runtime-tk.{js,wasm}`,
  initialises Tcl + Tk, constructs the em-x11 instance (which mirrors itself
  onto `globalThis.emX11` for DevTools / EM_JS bridge access), and returns
  the API object. em-x11 JS is dynamically imported so Tcl-only consumers
  never fetch the canvas/compositor/input bundle.

```js
import { loadTcldide } from '/src/tcldide.js';

// Tcl-only
const tcldide = await loadTcldide();

// Tcl + Tk
const tcldide = await loadTcldide({ tk: true, width: 800, height: 600 });
```

#### `TcldideConfig`

| Field      | Type                          | Default                              | Notes |
|------------|-------------------------------|--------------------------------------|-------|
| `tk`       | `boolean`                     | `false`                              | Enable Tk + em-x11. When false, only Tcl is loaded. |
| `indexURL` | `string`                      | base: `/build/artifacts/tcldide-runtime-base`<br>tk: `/build/artifacts/tcldide-runtime-tk` | Base URL for the runtime artifacts. Varies by mode. |
| `glueURL`  | `string`                      | `${indexURL}/tcldide-runtime-{base,tk}.js` | Override the .js glue URL. |
| `wasmURL`  | `string`                      | `${indexURL}/tcldide-runtime-{base,tk}.wasm` | Override the .wasm URL. |
| `canvas`   | `HTMLCanvasElement`           | (auto-create)                        | Existing canvas for Tk to paint into. Only meaningful with `{tk: true}`. |
| `width`    | `number`                      | `1024`                               | Logical width of the auto-created canvas. Only with `{tk: true}`. |
| `height`   | `number`                      | `768`                                | Logical height of the auto-created canvas. Only with `{tk: true}`. |
| `stdout`   | `(msg: string) => void`       | `console.log`                        | Replacement for Tcl's `puts stdout`. Receives one line per call. |
| `stderr`   | `(msg: string) => void`       | `console.error`                      | Replacement for Tcl's `puts stderr`. |

---

## `TcldideAPI`

The object returned by `loadTcldide`.

### `tcldide.runTcl(code) → string`

Evaluate a Tcl script synchronously. Returns the script's result as a
string (same as the `puts $result` you'd see in `tclsh`). Throws
[`TclError`](#class-tclerror) on `TCL_ERROR`.

Best for scripts that complete immediately: widget creation, arithmetic,
variable assignment.

```js
tcldide.runTcl(`
  button .b -text Click -command { incr ::n }
  pack .b
`);
const v = tcldide.runTcl('expr {2 + 3}');     // "5"
```

### `tcldide.runTclAsync(code) → Promise<string>`

Evaluate a Tcl script asynchronously, returning a Promise that resolves
to the script's result. Supports `vwait`, `tkwait`, `after`, and other
blocking Tcl commands that yield to the event loop.

```js
const result = await tcldide.runTclAsync(`
  after 200 { set ::done 1 }
  vwait ::done
  return "ok"
`);
```

### `tcldide.globals`

Tcl global namespace, mirroring `pyodide.globals`. **All methods are
synchronous** just like their Pyodide counterparts.

| Method                   | Returns                  | Description |
|--------------------------|--------------------------|-------------|
| `globals.get(name)`      | `string \| undefined`    | Read a Tcl global variable. `undefined` if unset. |
| `globals.set(name, val)` | `void`                   | Write a Tcl global variable (value coerced via `String()`). |
| `globals.has(name)`      | `boolean`                | True if the variable is defined. |
| `globals.delete(name)`   | `void`                   | Unset; no-op if it doesn't exist. |

```js
tcldide.runTcl('set ::greeting "hi"');
tcldide.globals.get('greeting');         // "hi"
tcldide.globals.set('count', 42);
tcldide.runTcl('return $::count');       // "42"
```

### `tcldide.canvas`

Only present in Tk mode (`tcldide.canvas` is `undefined` in base mode).

| Method                       | Returns               |
|------------------------------|-----------------------|
| `canvas.getCanvas2D()`       | `HTMLCanvasElement`   |

Returns the HTML5 canvas Tk is painting into. Mirrors
`pyodide.canvas.getCanvas2D()`. To attach an existing canvas instead
of letting tcldide create one, pass it as the `canvas` option to
`loadTcldide`. Runtime `setCanvas2D` is not supported because em-x11
binds its renderer at startup.

### `tcldide.setStdout(opts)` / `tcldide.setStderr(opts)`

Replace the line-buffered stdout/stderr handler. Same shape as
Pyodide's `setStdout` (only the `batched` form is supported).

```js
tcldide.setStdout({ batched: (line) => myLog.append(line) });
```

### `tcldide.version` · `tcldide.tkVersion`

The Tcl and Tk runtime versions, e.g. `"8.6.15"`. Read straight out of
`$tcl_version` / `$tk_version` so you get whatever the linked archives
report. `tkVersion` is `undefined` in base (Tcl-only) mode.

### `tcldide.FS`

The Emscripten in-memory filesystem object. Same surface as
`pyodide.FS` — use it to stage files into Tcl's view of the world or
to mount IDB / NODEFS. The Tcl/Tk script libraries are pre-mounted at
`/tcl` and `/tk` (set via `--preload-file`).

```js
tcldide.FS.writeFile('/script.tcl', 'puts hello');
tcldide.runTcl('source /script.tcl');
```

### `tcldide.em` / `tcldide.module`

Escape hatches. `em` is the [`@devscholar/em-x11`](https://github.com/DevScholar/em-x11)
instance returned by `createEmX11` — use `em.fs`, `em.display`,
`em.debug` for typed access; `em._host` is an unstable internal
escape hatch. `em` is `undefined` in base (Tcl-only) mode.

`module` is the raw Emscripten module. Use these only for things the
high-level API doesn't cover yet.

---

## Errors

### `class TclError`

Thrown by `runTcl` / `runTclAsync` when the evaluated script returns
`TCL_ERROR`. The `errorInfo` property and `.message` both contain the
value of Tcl's `$errorInfo` (the closest analog to a Python traceback).

```js
try {
  tcldide.runTcl('error "boom"');
} catch (e) {
  if (e instanceof TclError) console.warn(e.errorInfo);
}
```

---

## Mapping from Pyodide

| Pyodide                              | tcldide                       |
|--------------------------------------|-------------------------------|
| `loadPyodide(config)`                | `loadTcldide(config)`          |
| `pyodide.runPython(code)`            | `tcldide.runTcl(code)`           |
| `pyodide.runPythonAsync(code)`       | `tcldide.runTclAsync(code)`      |
| `pyodide.globals.get(n)`             | `tcldide.globals.get(n)`          |
| `pyodide.globals.set(n, v)`          | `tcldide.globals.set(n, v)`      |
| `pyodide.canvas.getCanvas2D()`       | `tcldide.canvas.getCanvas2D()`   |
| `pyodide.canvas.setCanvas2D(c)`      | `loadTcldide({ canvas: c })`   |
| `pyodide.setStdout({ batched })`     | `tcldide.setStdout({ batched })` |
| `pyodide.setStderr({ batched })`     | `tcldide.setStderr({ batched })` |
| `pyodide.version`                    | `tcldide.version`                |
| `pyodide.FS`                         | `tcldide.FS`                     |
| `PythonError`                        | `TclError`                    |

---

## Calling JavaScript from Tcl (`::tcldide::jscall`)

tcldide's low-level JS bridge lets Tcl call a JavaScript function that
has been registered in Emscripten's function table via
`Module.addFunction`.

### Overview

```
JS side     Register a function with Module.addFunction / cwrap, store
            the pointer in a Tcl variable.

Tcl side    ::tcldide::jscall $ptr returnType argType ?args...?
                → calls the wasm function, returns the result as a Tcl value
```

### Step by step

1. On the JS side, register a function in the Emscripten function table:

```js
// cwrap a wasm export that takes/returns the right types, or use addFunction:
const fnPtr = Module.addFunction((name) => {
  console.log('Hello from Tcl:', UTF8ToString(name));
  return 42;
}, 'ii');  // int(*)(int) — but for strings, use the asm sig for char*
```

2. Stash the pointer in a Tcl variable:

```js
tcldide.runTcl(`set ::myCallback ${fnPtr}`);
```

3. Call it from Tcl:

```tcl
::tcldide::jscall $::myCallback string int "world"
```

### `::tcldide::jscall fcnPtr returnType argType ?arg1 arg2 ...?`

The Tcl command registered by `opt/tcldide.c`'s `Tcldide_Init`.

| Argument     | Type     | Description |
|--------------|----------|-------------|
| `fcnPtr`     | integer  | Emscripten function-table index, as returned by `Module.addFunction`. |
| `returnType` | string   | One of `void int bool double string array`. |
| `argType`    | string   | One of `void int bool double string array`. The wasm-side function signature. |
| `arg…`       | values   | Zero args if `argType` is `void`; one arg for the single-argument form; multiple args for the packed-list form (which requires `argType` to be `string` or `array`). |

```tcl
# zero-argument call
::tcldide::jscall $ptr void void

# single-argument call
::tcldide::jscall $ptr int string "hello"

# multi-argument call (args packed as Tcl list → single string)
::tcldide::jscall $ptr int string 3 4
```

#### Multi-argument form

Emscripten's `addFunction` registers a function with a fixed wasm
signature, and wasm's `call_indirect` traps if the runtime signature
doesn't match the table entry. So variable arity is impossible at the
wasm level. The multi-arg form sidesteps this by serialising all Tcl
args as a single Tcl-list string; the JS wrapper (registered via
`addFunction`) parses that list and coerces each element back to its
declared type before invoking the user function.

Note: upstream tcldide (ecky-l) provides a `Module.tcldide.jswrap`
convenience that bundles `addFunction` + type coercion + Tcl command
generation. This helper has not yet been ported to the current fork.

### Type reference

| Token    | C type          | Tcl representation |
|----------|-----------------|--------------------|
| `void`   | `void`          | empty string       |
| `int`    | `int`           | integer string     |
| `bool`   | `int` (0/1)     | integer string     |
| `double` | `double`        | floating-point string |
| `string` | `const char *`  | string             |
| `array`  | `const char *`  | string (binary-safe usage) |

---

## Not yet implemented

These exist in Pyodide but are out of scope for the first tcldide API
cut. None of them are needed to write a typical Tk demo.

- `loadPackage`, `loadPackagesFromImports`, `pyimport`, `unpackArchive`
- Foreign function interface (`pyodide.ffi.*`, proxies, `toPy`)
- `registerJsModule` / `unregisterJsModule` (use [`::tcldide::jscall`](#calling-javascript-from-tcl-tcldidejscall) instead)
- `setStdin`, `setInterruptBuffer`, `checkInterrupt`
- Lockfiles, `mountNativeFS`, `mountNodeFS`
- Runtime `canvas.setCanvas2D(c)` (pass `canvas` to `loadTcldide` instead)
- `Module.tcldide.jswrap` convenience helper
