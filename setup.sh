#!/usr/bin/env bash
# setup.sh — one-shot setup for tcldide.
#
# Called automatically by `pnpm install` (postinstall hook), or can be run
# manually after cloning. Downloads Tcl/Tk source, configures and builds the
# static archives, and installs them into jsbuild/.
#
# em-x11 is detected but NOT fetched or built here. If missing the script
# prints install instructions and exits; the user installs it and re-runs.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ---------------------------------------------------------------------------
# Reproducibility-test clone detection (runs on WSL and Git Bash alike)
# ---------------------------------------------------------------------------
if echo "$PROJECT_DIR" | grep -qi reproducibility; then
    if [ -d .git ]; then
        rm -rf .git
        echo "[reproducibility] removed .git from $PROJECT_DIR — reproducibility-test clone"
    fi
fi

if [ "$(uname -s)" != "Linux" ]; then
  echo "ERROR: This project requires Linux. Run from WSL, not Git Bash or Windows."
  exit 1
fi

TCLVERSION=${TCLVERSION:-8.6.15}
TKVERSION=${TKVERSION:-8.6.15}

# ---------------------------------------------------------------------------
# Prerequisite check
# ---------------------------------------------------------------------------
missing=()
for cmd in emcc make autoconf wget; do
    command -v "$cmd" &>/dev/null || missing+=("$cmd")
done

if [ ${#missing[@]} -gt 0 ]; then
    echo "ERROR: missing required tools: ${missing[*]}"
    echo "  emcc     — Emscripten SDK (source emsdk_env.sh first)"
    echo "  make     — GNU make"
    echo "  autoconf — GNU autoconf"
    echo "  wget     — for downloading source tarballs"
    exit 1
fi

# ---------------------------------------------------------------------------
# Detect em-x11 (user's responsibility — we only check, never fetch)
# ---------------------------------------------------------------------------
EMX11_DIR="${EMX11_DIR:-$(cd "$(dirname "$0")" && pwd)/../em-x11}"

if [ ! -d "$EMX11_DIR/native/include/X11" ]; then
    echo "ERROR: em-x11 headers not found at $EMX11_DIR/native/include/X11"
    echo ""
    echo "  em-x11 must be cloned as a sibling directory and built first:"
    echo "    cd $(dirname "$0")/../em-x11"
    echo "    pnpm install"
    echo "    pnpm build:native"
    echo ""
    echo "  Then re-run this script."
    exit 1
fi

if [ ! -f "$EMX11_DIR/build/artifacts/libX11.a" ]; then
    echo "ERROR: em-x11 not built (headers exist but archives missing)."
    echo "  Run: cd ../em-x11 && pnpm build:native"
    exit 1
fi

echo "em-x11 detected at $EMX11_DIR — OK"

# ---------------------------------------------------------------------------
# Tcl source tree
# ---------------------------------------------------------------------------
if [ -d ignored-area/third-party/tcl/unix ]; then
    echo "tcl/ already present — skipping download."
else
    echo "==> Downloading and preparing Tcl $TCLVERSION ..."
    make tcldideprep
fi

# ---------------------------------------------------------------------------
# Tk source tree
# ---------------------------------------------------------------------------
if [ -d ignored-area/third-party/tk/unix ]; then
    echo "tk/ already present — skipping download."
else
    echo "==> Downloading and preparing Tk $TKVERSION ..."
    make tkprep
fi

# ---------------------------------------------------------------------------
# Build and install Tcl
# ---------------------------------------------------------------------------
if [ -f jsbuild/lib/libtcl8.6.a ]; then
    echo "jsbuild/lib/libtcl8.6.a already present — skipping Tcl build."
else
    echo "==> Configuring and building Tcl $TCLVERSION ..."
    make config
    make tcldideinstall
fi

# ---------------------------------------------------------------------------
# Build and install Tk
# ---------------------------------------------------------------------------
if [ -f jsbuild/lib/libtk8.6.a ]; then
    echo "jsbuild/lib/libtk8.6.a already present — skipping Tk build."
else
    echo "==> Configuring and building Tk $TKVERSION ..."
    make tkinstall
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
cat <<'EOF'

tcldide setup complete. Next steps:

  pnpm build:native   # compile tcldide-runtime.wasm
  pnpm dev            # start Vite dev server

EOF
