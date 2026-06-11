# tcldide vs upstream Tcl/Tk 8.6.15

This document describes how the Tcl and Tk source trees built by tcldide
diverge from the official 8.6.15 releases.

## Summary

**tcldide applies no source-level patches.** Both Tcl and Tk are
extracted from the official tarballs and built unmodified. All
wasm-specific behaviour comes from build flags (`emconfigure` host
overrides, `ac_cv_*` cache variables, `CFLAGS` injection) and a
post-configure `sed` pass.

The tcldide-specific Tcl commands (`::tcldide::dom`, `::tcldide::jscall`) are
**not** compiled into `libtcl` — they live in
[`opt/tcldide.c`](../opt/tcldide.c) and are linked into
`tcldide-runtime` directly. The runtime calls `Tcldide_Init(interp)` after
`Tcl_Init` and registers them on the live interpreter.

| Component        | Upstream            | Source patches | Build-level changes |
|------------------|---------------------|----------------|---------------------|
| Tcl 8.6.15       | tcl-core8.6.15-src  | none           | `--host=wasm32-unknown-emscripten`, `ac_cv_*` overrides, archives only (no tclsh) |
| Tk 8.6.15        | tk8.6.15-src        | none           | em-x11 X11 headers, fontconfig disabled, Xft/XKB overrides, archives only (no wish) |
| `::tcldide::*` cmds | tcldide's own      | n/a            | compiled into `runtime/`, not into libtcl |

This file used to document a 200-line `tcldide.patch` inherited from
the upstream [wacl](https://github.com/ecky-l/wacl) project.
That patch and its companion `opt/tcldideAppInit.c` have been removed —
every hunk was either obsolete on modern emscripten or replaceable by
a configure flag. See **Why no patch is needed** below for the
hunk-by-hunk rationale.

## Tcl 8.6.15 (build-level only)

Source: `wget` of `tcl-core8.6.15-src.tar.gz`, extracted under `ignored-area/third-party/tcl/`.
No `patch` step.

### Configure
```
emconfigure ./configure \
    --host=wasm32-unknown-emscripten \
    --prefix=$(CURDIR)/jsbuild \
    --disable-threads --disable-load --disable-shared \
    ac_cv_have_intrinsic_cpuid=no \
    ac_cv_func_strtoul=yes \
    tcl_cv_strtoul_unbroken=ok \
    tcl_cv_strstr_unbroken=ok
```

Key choices:

- **`--host=wasm32-unknown-emscripten`** — without this, autoconf treats
  the build as native and runs Tcl's broken-function probes (`strstr`,
  `strtoul`, `strtod`) via `AC_TRY_RUN`. Those exit with a non-zero
  status under emscripten and abort the configure. With `--host`,
  autoconf sets `cross_compiling=yes` and skips the runtime probes.
- **`ac_cv_have_intrinsic_cpuid=no`** — preempts `tclUnixCompat.c`'s
  GNU/x86 cpuid feature detection. wasm32 has no cpuid intrinsic.
- **`ac_cv_func_strtoul=yes`** — Tcl 8.6.15 ships `compat/strtoul.c`, but
  emscripten libc already exports `strtoul`. Without this override,
  configure detects the missing function (cross-compile can't probe) and
  enables the compat copy, causing `wasm-ld: duplicate symbol: strtoul`
  at runtime link.
- **`tcl_cv_strtoul_unbroken=ok`, `tcl_cv_strstr_unbroken=ok`** — the
  cross-compile path defaults these to "unknown", which Tcl treats as
  broken and pulls in `compat/strtoul.c` / `compat/strstr.c`. Same
  duplicate-symbol fallout as above.
- `--disable-threads --disable-load --disable-shared` — single-threaded
  static archive only; dynamic loading is provided at the side-module
  layer by em-x11 / Tk runtime, not by Tcl's `dlopen` shim.

Post-configure sed strips `-O2` so it does not override `-Oz` from
`BCFLAGS`.

### Build
```
emmake make -j libtcl8.6.a libtclstub8.6.a
```

Targets are listed explicitly so the default `binaries` target
(which would build `tclsh`) is never invoked. `tclsh` requires a
native `main()` entry, has no role in a browser build, and pulls in
`isatty`/stdin behaviour that emscripten will not satisfy
silently.

### Install (manual cp)
```
cp tcl/unix/libtcl8.6.a tcl/unix/libtclstub8.6.a jsbuild/lib/
cp tcl/unix/tclConfig.sh tcl/unix/tclooConfig.sh jsbuild/lib/
cp tcl/generic/tcl.h … jsbuild/include/
```

`make install` would also try to install `tclsh` and is therefore
sidestepped.

## Tk 8.6.15 (build-level only)

Source: `wget` of `tk8.6.15-src.tar.gz`, extracted under `ignored-area/third-party/tk/`.
No `patch` step.

### Configure
```
PATH="$(CURDIR)/scripts:$$PATH" \
EM_X11_INCLUDES="../em-x11/native/include" \
EM_X11_LIBDIR="../em-x11/build/artifacts" \
XFT_CFLAGS="-I$(EM_X11_INCLUDES)" \
XFT_LIBS="-L$(EM_X11_LIBDIR) -lemX11" \
ac_cv_lib_Xft_XftFontOpen=yes \
ac_cv_lib_fontconfig_FcFontSort=no \
ac_cv_lib_X11_XkbKeycodeToKeysym=yes \
cross_compiling=yes \
emconfigure ./configure --prefix=$(CURDIR)/jsbuild \
    --host=wasm32-unknown-emscripten \
    --with-tcl=$(CURDIR)/jsbuild/lib \
    --x-includes=$(EM_X11_INCLUDES) \
    --x-libraries=$(EM_X11_LIBDIR) \
    --disable-shared --disable-load --disable-threads
```

Same em-x11 redirection trick the project has always used: real
`X11/*.h` headers come from em-x11, but no Xlib `.so` is supplied.
Tk's unresolved X11 symbols stay in the static archive and are
filled at the runtime link step by em-x11's split archives —
`libX11.a`, `libXext.a`, `libXrender.a`, `libfontconfig.a`,
`libXft.a` (the emscripten-ports script at
`tools/ports/em_x11.py` returns the full archive list; GLX is
not used by Tk).

- `ac_cv_lib_Xft_XftFontOpen=yes` and
  `ac_cv_lib_fontconfig_FcFontSort=no` short-circuit Tk's optional
  dependency probes — Xft is provided by em-x11, fontconfig is not.
- `ac_cv_lib_X11_XkbKeycodeToKeysym=yes` — XKB support is provided by
  em-x11; prevents Tk from falling back to the non-XKB keycode path.
- `scripts/xft-config` shim on `PATH` answers `--cflags`/`--libs`
  for Tk's Xft probe.
- `XFT_CFLAGS` / `XFT_LIBS` — provide the Xft dependency directly via env
  so Tk's configure probe finds em-x11's Xft symbols without needing
  pkg-config.

Post-configure sed:
- strip `-O2` (replaced with `-Oz` from `BCFLAGS`).
- force `X11_INCLUDES = -I$(EM_X11_INCLUDES)` so em-x11's headers
  win over anything the X probe inserted.
- append `-DTK_USE_INPUT_METHODS=1` to `CFLAGS` so Tk's XIM input
  method path is compiled in.

### Install
`make tkinstall` deliberately skips Tk's `install-binaries` target,
which would build `wish` and require linking against em-x11's
archives at this stage. `wish` only makes sense in a page that has
a Canvas attached, so it is built at the demo / runtime layer
instead.

## `::tcldide::*` Tcl commands

[`opt/tcldide.c`](../opt/tcldide.c) registers two Tcl commands when its
`Tcldide_Init` is called:

- `::tcldide::dom action selector key val` — query `document` via
  `EM_ASM_INT`, call `querySelectorAll(selector)` and set
  `attr` or `style.{key} = val` on each match. Returns the count
  of elements changed.
- `::tcldide::jscall fcnPtr returnType argType ?args…?` — invoke a
  function pointer obtained from JS (e.g. via `Module.addFunction`)
  with declared C signature, passing arguments coerced from Tcl
  through the listed types (`void` / `int` / `double` / `bool` /
  `string` / `array`).

Wiring (already in [runtime/tcldide-runtime.c](../runtime/tcldide-runtime.c)):

```c
extern int Tcldide_Init(Tcl_Interp *interp);
…
g_interp = Tcl_CreateInterp();
Tcl_Init(g_interp);
Tcldide_Init(g_interp);   // registers ::tcldide::dom, ::tcldide::jscall
Tk_Init(g_interp);
```

A failed `Tcldide_Init` is non-fatal: a runtime without the JS bridge
can still evaluate pure-Tcl/Tk code.

[`opt/tcldide.c`](../opt/tcldide.c) is added to the runtime executable in
[runtime/CMakeLists.txt](../runtime/CMakeLists.txt) — there is no
plumbing on the Tcl side. The previous `TCLDIDE_DIR` injection into
`tcl/unix/Makefile.in` is gone.

## Two-wasm architecture (8.6.15)

tcldide now produces two wasm artifacts from the same C source
(`tcldide-runtime.c`), gated by `#ifdef WITH_TK`:

| Artifact | Defines | Links | Use case |
|----------|---------|-------|----------|
| `tcldide-runtime-base` | (none) | libtcl8.6.a + tcl-poll.c | Tcl-only, no em-x11 dep |
| `tcldide-runtime-tk` | `WITH_TK` | libtcl8.6.a + libtk8.6.a + em-x11 port | Full Tcl/Tk GUI |

The base build uses a minimal `poll.c` override (`tcl-poll.c`) with zero
em-x11 dependencies. The Tk build uses em-x11's full `poll.c` override
(via the em-x11 port) which integrates with the browser event loop.

## Why no patch is needed

The historical `tcldide.patch` had seven hunks. All are now obsolete or
covered by a build-level option:

| Hunk                                              | Replacement |
|---------------------------------------------------|-------------|
| `configure.in`: delete `strstr`/`strtoul`/`strtod` broken-func probes | `--host=wasm32-unknown-emscripten` triggers `cross_compiling=yes`; runtime probes are skipped automatically |
| `Makefile.in`: add `TCLDIDE_OBJS` from `../opt/`     | `opt/tcldide.c` is compiled into `tcldide-runtime`, not libtcl |
| `Makefile.in`: drop `${TCL_EXE}` from `binaries` and `install` | only `make libtcl8.6.a libtclstub8.6.a` is invoked; install is manual `cp` |
| `tclUnixCompat.c`: `#undef HAVE_CPUID`            | `ac_cv_have_intrinsic_cpuid=no` at configure time |
| `tclUnixChan.c` / `tclUnixNotfy.c`: `select(exceptfds=NULL)` | runtime uses Tcl's default Unix notifier; em-x11's poll.c override handles yielding to the browser |
| `tcl.h`: `#undef TCL_WIDE_INT_IS_LONG`            | `sizeof(long) == 4` on wasm32, so configure never defines it; the undef is a no-op |
| `fake-rfc2553.c`: `#define HAVE_STRLCPY 1`        | modern emscripten libc exports `strlcpy`; autoconf detects it normally |
| (new in 8.6.15) `compat/strtoul.c` duplicate symbol | `ac_cv_func_strtoul=yes` prevents Tcl from bundling its own strtoul |
| (new in 8.6.15) `compat/strstr.c` / `compat/strtoul.c` pulled in | `tcl_cv_strtoul_unbroken=ok` + `tcl_cv_strstr_unbroken=ok` tells Tcl the libc versions work; skips compat copies |

If a future Tcl/Tk version regresses one of these assumptions, the
fix should land here as a `.patch` file applied during `tcldideprep` /
`tkprep`. As of Tcl/Tk 8.6.15 + emscripten 5.x, none is needed.

## Risks of the no-patch approach

- **Sourceforge mirror reliability.** `setup.sh` relies on
  `prdownloads.sourceforge.net` returning the pinned tarball; mirror
  outages stall the build. Consider switching to GitHub mirrors with
  SHA256 verification if this becomes a problem.
- **Version drift.** All flags above were validated against
  Tcl/Tk 8.6.15 specifically. Bumping `TCLVERSION` may need new
  `ac_cv_*` overrides; bumping major versions almost certainly will.
  The 8.6.6→8.6.15 jump only required the three new overrides
  documented above (`ac_cv_func_strtoul`, `tcl_cv_strtoul_unbroken`,
  `tcl_cv_strstr_unbroken`), plus `ac_cv_lib_X11_XkbKeycodeToKeysym`
  and `TK_USE_INPUT_METHODS=1` on the Tk side.
- **Notifier ordering.** `Tcl_SetNotifier` in
  `runtime/tcldide-runtime.c` must run before any `Tcl_CreateInterp`
  call, otherwise Tcl's stock `tclUnixNotfy.c` `Tcl_InitNotifier`
  runs first and would `select()` natively. The current code does not
  call `Tcl_SetNotifier` — it relies on em-x11's `poll.c` override
  (strong symbol) to intercept `poll()`/`select()` calls from Tcl's
  default Unix notifier. Do not remove the poll override without
  providing an alternative notifier.
