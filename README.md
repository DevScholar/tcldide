# Tcldide

A WebAssembly build of Tcl/Tk 8.6.15 that runs real Tk programs in the browser.

![tk-hello demo screenshot](./screenshots/counter.png)

Forked from [Wacl](https://github.com/ecky-l/wacl) by ecky-l — a WebAssembly build of Tcl (no GUI). Tk GUI support and the [em-x11](https://github.com/DevScholar/em-x11) X11 stack (display, input, compositing) were added by this fork.

# Two modes

Tcldide supports two runtime modes:

- **Tcl-only** (`loadTcldide()`) — pure Tcl scripting, no GUI. Lightweight wasm (libtcl8.6.a only).
- **Tk mode** (`loadTcldide({ tk: true })`) — full Tcl/Tk + em-x11 canvas. Dynamically imports em-x11 JS host.

# Prerequisites

- Linux
- Emscripten (latest emsdk recommended; `emcc` must be on `PATH`)
- Node.js ≥ 20, pnpm ≥ 9
- make, autoconf, wget
- [em-x11](https://github.com/DevScholar/em-x11) cloned as a sibling directory and built (`pnpm install && pnpm build:native`)

# Quick start

```bash
pnpm install        # downloads Tcl/Tk sources, builds static archives
pnpm build:native   # compiles tcldide-runtime-base.wasm + tcldide-runtime-tk.wasm
pnpm dev            # starts Vite dev server
```

`pnpm install` will detect whether em-x11 is present and built — if not, it prints instructions and exits.

# Build

```bash
pnpm build:native
```

# Run

```bash
pnpm dev
```

# Documentation

[docs/api.md](docs/api.md)

# License

BSD 3-Clause. See [LICENSE.md](LICENSE.md).
