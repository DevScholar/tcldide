# tcldide vs upstream Tcl/Tk 8.6.6

This document describes how the Tcl and Tk source trees built by tcldide
diverge from the official 8.6.6 releases.

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
| Tcl 8.6.6        | tcl-core8.6.6-src   | none           | `--host=wasm32-unknown-emscripten`, `ac_cv_have_intrinsic_cpuid=no`, archives only (no tclsh) |
| Tk 8.6.6         | tk8.6.6-src         | none           | em-x11 X11 headers, fontconfig disabled, Xft override, archives only (no wish) |
| `::tcldide::*` cmds | tcldide's own       | n/a            | compiled into `runtime/`, not into libtcl |

This file used to document a 200-line `tcldide.patch` inherited from
the upstream [tcldide](https://github.com/ecky-l/tcldide) project.
That patch and its companion `opt/tcldideAppInit.c` have been removed —
every hunk was either obsolete on modern emscripten or replaceable by
a configure flag. See **Why no patch is needed** below for the
hunk-by-hunk rationale.

## Tcl 8.6.6 (build-level only)

Source: `wget` of `tcl-core8.6.6-src.tar.gz`, extracted under `ignored-area/third-party/tcl/`.
No `patch` step.

### Configure
```
emconfigure ./configure \
    --host=wasm32-unknown-emscripten \
    --prefix=$(CURDIR)/jsbuild \
    --disable-threads --disable-load --disable-shared \
    ac_cv_have_intrinsic_cpuid=no
```

Key choices:

- **`--host=wasm32-unknown-emscripten`** — without this, autoconf treats
  the build as native and runs Tcl's broken-function probes (`strstr`,
  `strtoul`, `strtod`) via `AC_TRY_RUN`. Those exit with a non-zero
  status under emscripten and abort the configure. With `--host`,
  autoconf sets `cross_compiling=yes` and skips the runtime probes.
- **`ac_cv_have_intrinsic_cpuid=no`** — preempts `tclUnixCompat.c`'s
  GNU/x86 cpuid feature detection. wasm32 has no cpuid intrinsic.
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

## Tk 8.6.6 (build-level only)

Source: `wget` of `tk8.6.6-src.tar.gz`, extracted under `ignored-area/third-party/tk/`.
No `patch` step.

### Configure
```
PATH="$(CURDIR)/scripts:$$PATH" \
EMX11_INCLUDES="../em-x11/native/include" \
EMX11_LIBDIR="../em-x11/build/artifacts" \
ac_cv_lib_Xft_XftFontOpen=yes \
ac_cv_lib_fontconfig_FcFontSort=no \
cross_compiling=yes \
emconfigure ./configure --prefix=$(CURDIR)/jsbuild \
    --host=wasm32-unknown-emscripten \
    --with-tcl=$(CURDIR)/jsbuild/lib \
    --x-includes=$(EMX11_INCLUDES) \
    --x-libraries=$(EMX11_LIBDIR) \
    --disable-shared --disable-load --disable-threads
```

Same em-x11 redirection trick the project has always used: real
`X11/*.h` headers come from em-x11, but no Xlib `.so` is supplied.
Tk's unresolved X11 symbols stay in the static archive and are
filled at the runtime link step by em-x11's split archives —
`libX11.a`, `libXext.a`, `libXrender.a`, `libfontconfig.a`,
`libXft.a` (the emscripten-ports script at
`tools/ports/emx11.py` returns the full archive list; GLX is
not used by Tk).

- `ac_cv_lib_Xft_XftFontOpen=yes` and
  `ac_cv_lib_fontconfig_FcFontSort=no` short-circuit Tk's optional
  dependency probes — Xft is provided by em-x11, fontconfig is not.
- `scripts/xft-config` shim on `PATH` answers `--cflags`/`--libs`
  for Tk's Xft probe.

Post-configure sed:
- strip `-O2` (replaced with `-Oz` from `BCFLAGS`).
- force `X11_INCLUDES = -I$(EMX11_INCLUDES)` so em-x11's headers
  win over anything the X probe inserted.

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

## Why no patch is needed

The historical `tcldide.patch` had seven hunks. All are now obsolete or
covered by a build-level option:

| Hunk                                              | Replacement |
|---------------------------------------------------|-------------|
| `configure.in`: delete `strstr`/`strtoul`/`strtod` broken-func probes | `--host=wasm32-unknown-emscripten` triggers `cross_compiling=yes`; runtime probes are skipped automatically |
| `Makefile.in`: add `TCLDIDE_OBJS` from `../opt/`     | `opt/tcldide.c` is compiled into `tcldide-runtime`, not libtcl |
| `Makefile.in`: drop `${TCL_EXE}` from `binaries` and `install` | only `make libtcl8.6.a libtclstub8.6.a` is invoked; install is manual `cp` |
| `tclUnixCompat.c`: `#undef HAVE_CPUID`            | `ac_cv_have_intrinsic_cpuid=no` at configure time |
| `tclUnixChan.c` / `tclUnixNotfy.c`: `select(exceptfds=NULL)` | runtime installs its own notifier via `Tcl_SetNotifier`; the patched `select()` paths are never executed |
| `tcl.h`: `#undef TCL_WIDE_INT_IS_LONG`            | `sizeof(long) == 4` on wasm32, so configure never defines it; the undef is a no-op |
| `fake-rfc2553.c`: `#define HAVE_STRLCPY 1`        | modern emscripten libc exports `strlcpy`; autoconf detects it normally |

If a future Tcl/Tk version regresses one of these assumptions, the
fix should land here as a `.patch` file applied during `tcldideprep` /
`tkprep`. As of Tcl/Tk 8.6.6 + emscripten 5.x, none is needed.

## Risks of the no-patch approach

- **Sourceforge mirror reliability.** `setup.sh` relies on
  `prdownloads.sourceforge.net` returning the pinned tarball; mirror
  outages stall the build. Consider switching to GitHub mirrors with
  SHA256 verification if this becomes a problem.
- **Version drift.** All flags above were validated against
  Tcl/Tk 8.6.6 specifically. Bumping `TCLVERSION` may need new
  `ac_cv_*` overrides; bumping major versions almost certainly will.
- **Notifier ordering.** `Tcl_SetNotifier` in
  `runtime/tcldide-runtime.c` must run before any `Tcl_CreateInterp`
  call, otherwise Tcl's stock `tclUnixNotfy.c` `Tcl_InitNotifier`
  runs first and would `select()` natively. The current order
  (`install_browser_notifier()` → `Tcl_CreateInterp()`) is correct;
  do not reorder without re-checking.
