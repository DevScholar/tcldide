/*
 * tcldide-runtime -- generic Tcl/Tk wasm runtime exposing a Pyodide-style
 * JS API. main() initialises Tcl + Tk, kicks one update so the main
 * window realises, then registers an rAF-driven tick via
 * emscripten_set_main_loop and returns. The runtime stays alive
 * (noExitRuntime). All evaluation happens through cwrap'd entry points
 * the JS loader calls:
 *
 *   tcldide_eval        -- Tcl_Eval into a private result slot + drain.
 *   tcldide_result      -- last captured result (or errorInfo on TCL_ERROR).
 *   tcldide_get_var     -- Tcl_GetVar in global scope.
 *   tcldide_set_var     -- Tcl_SetVar in global scope.
 *
 * Tcl uses its default Unix notifier (tclUnixNotfy.c) which calls
 * select() on the X11 display fd. em-x11's poll.c override handles
 * yielding to the browser — no custom notifier needed.
 */

#include <tcl.h>
#ifdef WITH_TK
#include <tk.h>
#endif
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <emscripten.h>

extern int Tcldide_Init(Tcl_Interp *interp);

/* --------------------------------------------------------------------- */

static Tcl_Interp *g_interp     = NULL;
static char       *g_result     = NULL;  /* malloc'd; raw UTF-8 for JS */
static char       *g_var_result = NULL;  /* malloc'd; raw UTF-8 for JS (get/set) */
static Tcl_Encoding g_utf8_enc  = NULL;

/* Tk 8.6 (TCL_UTF_MAX=3) stores emoji internally as CESU-8 surrogate
 * pairs (6 bytes/emoji). Stock `wish file.tcl` gets there because the
 * file channel runs source bytes through the "utf-8" encoding, whose
 * UtfToUtfProc normalises native 4-byte UTF-8 to CESU-8. Our JS bridge
 * hands `Tcl_Eval` a raw UTF-8 buffer from `stringToUTF8`, skipping
 * that normalisation -- entry/text DeleteChars then assumes 3-byte
 * surrogate-half stride and corrupts the heap on any emoji edit.
 * Convert at the boundary in both directions to match stock semantics. */
static void ensure_utf8_enc(void) {
    if (!g_utf8_enc) g_utf8_enc = Tcl_GetEncoding(NULL, "utf-8");
}

static const char *to_cesu8(const char *src, Tcl_DString *ds) {
    Tcl_DStringInit(ds);
    ensure_utf8_enc();
    if (!g_utf8_enc || !src) {
        if (src) Tcl_DStringAppend(ds, src, -1);
        return Tcl_DStringValue(ds);
    }
    Tcl_ExternalToUtfDString(g_utf8_enc, src, -1, ds);
    return Tcl_DStringValue(ds);
}

static const char *from_cesu8(const char *src, Tcl_DString *ds) {
    Tcl_DStringInit(ds);
    ensure_utf8_enc();
    if (!g_utf8_enc || !src) {
        if (src) Tcl_DStringAppend(ds, src, -1);
        return Tcl_DStringValue(ds);
    }
    Tcl_UtfToExternalDString(g_utf8_enc, src, -1, ds);
    return Tcl_DStringValue(ds);
}

static void set_result(const char *s) {
    if (g_result) { free(g_result); g_result = NULL; }
    if (s) {
        Tcl_DString ds;
        const char *out = from_cesu8(s, &ds);
        size_t n = strlen(out);
        g_result = (char *)malloc(n + 1);
        if (g_result) memcpy(g_result, out, n + 1);
        Tcl_DStringFree(&ds);
    }
}

static int eval_impl(const char *code) {
    if (!g_interp) { set_result("tcldide: interp not initialised"); return TCL_ERROR; }
    Tcl_DString ds;
    const char *cesu = to_cesu8(code, &ds);

    /* Normalise CRLF → LF so Tcl line continuation (backslash-newline)
     * works on CRLF files from Windows git clones. Emscripten has no
     * text-mode fopen, so `source` and `Tcl_Eval` both see raw bytes. */
    Tcl_DString norm;
    Tcl_DStringInit(&norm);
    const char *s = cesu;
    while (*s) {
        if (*s == '\r' && *(s+1) == '\n') { s++; continue; }
        Tcl_DStringAppend(&norm, s, 1);
        s++;
    }
    Tcl_DStringFree(&ds);

    int rc = Tcl_Eval(g_interp, Tcl_DStringValue(&norm));
    Tcl_DStringFree(&norm);

    /* Drain idle/expose handlers right away so widget realize/map paints
     * before the next rAF tick. Without this, a `pack [button .b ...]`
     * wouldn't appear on screen for up to 16ms. Same budget as the rAF
     * tick to cap runaway `after 0` chains. */
    for (int i = 0; i < 256; i++) {
        if (!Tcl_DoOneEvent(TCL_ALL_EVENTS | TCL_DONT_WAIT)) break;
    }

    if (rc == TCL_OK) {
        set_result(Tcl_GetStringResult(g_interp));
    } else {
        /* Match Pyodide's PythonError: include the traceback (errorInfo). */
        const char *info = Tcl_GetVar(g_interp, "errorInfo", TCL_GLOBAL_ONLY);
        set_result(info ? info : Tcl_GetStringResult(g_interp));
    }
    return rc;
}

EMSCRIPTEN_KEEPALIVE
int tcldide_eval(const char *code) {
    return eval_impl(code);
}

#ifndef WITH_TK
/* JSPI-safe async entry point for the base (Tcl-only) build.
 * tcldide_eval is a plain sync export (not in JSPI_EXPORTS) so
 * runTcl returns synchronously. This wrapper IS in JSPI_EXPORTS
 * so runTclAsync can suspend across vwait / blocking after. */
EMSCRIPTEN_KEEPALIVE
int tcldide_eval_async(const char *code) {
    return eval_impl(code);
}
#endif

EMSCRIPTEN_KEEPALIVE
const char *tcldide_result(void) {
    return g_result ? g_result : "";
}

/* get/set return raw UTF-8 to JS (so emoji round-trip cleanly through
 * UTF8ToString). The returned pointer lives until the next get/set call. */
static const char *stash_var_result(const char *cesu) {
    if (g_var_result) { free(g_var_result); g_var_result = NULL; }
    if (!cesu) return NULL;
    Tcl_DString ds;
    const char *out = from_cesu8(cesu, &ds);
    size_t n = strlen(out);
    g_var_result = (char *)malloc(n + 1);
    if (g_var_result) memcpy(g_var_result, out, n + 1);
    Tcl_DStringFree(&ds);
    return g_var_result;
}

EMSCRIPTEN_KEEPALIVE
const char *tcldide_get_var(const char *name) {
    if (!g_interp) return NULL;
    Tcl_DString name_ds;
    const char *cesu_name = to_cesu8(name, &name_ds);
    const char *val = Tcl_GetVar(g_interp, cesu_name, TCL_GLOBAL_ONLY);
    Tcl_DStringFree(&name_ds);
    return stash_var_result(val);
}

EMSCRIPTEN_KEEPALIVE
const char *tcldide_set_var(const char *name, const char *value) {
    if (!g_interp) return NULL;
    Tcl_DString name_ds, val_ds;
    const char *cesu_name = to_cesu8(name, &name_ds);
    const char *cesu_val  = to_cesu8(value, &val_ds);
    const char *result = Tcl_SetVar(g_interp, cesu_name, cesu_val, TCL_GLOBAL_ONLY);
    Tcl_DStringFree(&name_ds);
    Tcl_DStringFree(&val_ds);
    return stash_var_result(result);
}

/* NOT an XIM bypass. This wrapper sits ON the standard XIM ingress
 * path (em-x11_set_pending_key_text -> Xutf8LookupString) and only
 * performs a UTF-8 -> CESU-8 transcode required by Tcl 8.6's character
 * model:
 *
 *   em-x11's `Xutf8LookupString` honours its X11 spec contract and
 *   returns standard 4-byte UTF-8. Tk 8.6 (TCL_UTF_MAX=3) however
 *   needs CESU-8 surrogate pairs in entry/text storage -- stock Tk's
 *   tkUnixKey.c `TkpGetString` zero-converts the bytes from XIM, which
 *   surfaces as `DeleteChars` byte-stride mismatch and a `Tcl_Alloc`
 *   underflow on the next backspace against a 4-byte emoji.
 *
 * Rather than patching upstream Tk or breaking em-x11's X11 contract,
 * we intercept the keypress text at this tcldide-only seam: launch.ts
 * rebinds Module._emx11_set_pending_key_text to point at this wrapper,
 * which converts the JS-staged UTF-8 to CESU-8 before forwarding to
 * the real `emx11_set_pending_key_text`. Other em-x11 wasm clients
 * (pyodide-tk via CPython, future Motif clients, etc.) keep the
 * unmodified UTF-8 path because their string model isn't CESU-8.
 *
 * The proper long-term fix is upgrading Tcl/Tk from 8.6 to 9.x, whose
 * internal Unicode IS real UTF-8 -- at that point this wrapper can
 * be deleted and launch.ts's _emx11_set_pending_key_text rebind
 * removed. Until then this is the load-bearing compatibility layer
 * between X11 UTF-8 and Tcl 8.6 CESU-8, NOT temporary scaffolding. */
#ifdef WITH_TK
extern void emx11_set_pending_key_text(const char *utf8);

EMSCRIPTEN_KEEPALIVE
void tcldide_push_key_text(const char *utf8) {
    if (!utf8 || !*utf8) {
        emx11_set_pending_key_text(utf8);
        return;
    }
    Tcl_DString ds;
    const char *cesu = to_cesu8(utf8, &ds);
    emx11_set_pending_key_text(cesu);
    Tcl_DStringFree(&ds);
}
#endif

/* rAF-driven event pump. emscripten_set_main_loop calls this each
 * animation frame. We drain all pending Tcl events (X11, timer, idle)
 * then return so the browser stays responsive. A budget of 256 events
 * caps runaway `after 0` chains; normal widget realize/map rounds are
 * well within that.
 *
 * When poll() is blocked in emscripten_sleep (inner event loop in
 * tkwait/vwait), this tick must NOT process events — the inner loop
 * is waiting for specific events and would miss them if we consume
 * them here. emx11_is_blocking_in_poll gates this tick.
 *
 * Tcl uses its default Unix notifier (tclUnixNotfy.c) which calls
 * select() on the X11 display fd. Our poll.c override handles
 * yielding to the browser when the event queue is empty, so this
 * tick is lightweight — it only processes events that are already
 * queued. */
#ifdef WITH_TK
extern int emx11_is_blocking_in_poll(void);

void tick(void) {
    if (!g_interp) return;
    if (emx11_is_blocking_in_poll()) return;
    for (int i = 0; i < 256; i++) {
        if (!Tcl_DoOneEvent(TCL_ALL_EVENTS | TCL_DONT_WAIT)) break;
    }
}
#endif

int main(int argc, char **argv) {
    (void)argc; (void)argv;

    setenv("TCL_LIBRARY", "/tcl", 1);
#ifdef WITH_TK
    setenv("TK_LIBRARY",  "/tk",  1);
    setenv("DISPLAY",     ":0",   1);
#endif

    Tcl_FindExecutable("tcldide-runtime");

    /* Emscripten has no locale database; TclpSetInitialEncodings would
     * fall back to iso8859-1. DEFAULT_ENV at link time + this call give
     * us UTF-8 even if the env-var path is a no-op. */
    Tcl_SetSystemEncoding(NULL, "utf-8");

    g_interp = Tcl_CreateInterp();
    if (!g_interp) {
        fprintf(stderr, "tcldide-runtime: Tcl_CreateInterp failed\n");
        return 1;
    }

    if (Tcl_Init(g_interp) != TCL_OK) {
        fprintf(stderr, "tcldide-runtime: Tcl_Init failed: %s\n",
                Tcl_GetStringResult(g_interp));
        return 1;
    }

    /* Register ::tcldide::dom and ::tcldide::jscall (opt/tcldide.c). Failures
     * here are non-fatal -- a runtime without the JS bridge can still
     * eval pure-Tcl/Tk code. */
    if (Tcldide_Init(g_interp) != TCL_OK) {
        fprintf(stderr, "tcldide-runtime: Tcldide_Init failed: %s\n",
                Tcl_GetStringResult(g_interp));
    }

#ifdef WITH_TK
    /* Belt-and-braces: source auto.tcl so tcl_findLibrary is loaded
     * before Tk_Init asks for it. */
    Tcl_Eval(g_interp, "catch {source /tcl/auto.tcl}");

    if (Tk_Init(g_interp) != TCL_OK) {
        fprintf(stderr, "tcldide-runtime: Tk_Init failed: %s\n",
                Tcl_GetStringResult(g_interp));
        return 1;
    }

    /* Drain pending events (MapNotify, Expose) without blocking so Tk's
     * main window is realised before the first user eval. The rAF tick
     * will keep driving events thereafter. */
    for (int i = 0; i < 256; i++) {
        if (!Tcl_DoOneEvent(TCL_ALL_EVENTS | TCL_DONT_WAIT)) break;
    }
    set_result("");

    /* emscripten_set_main_loop schedules tick() at rAF rate and returns.
     * Module.noExitRuntime keeps the runtime alive so cwrap'd entry
     * points (tcldide_eval, etc.) remain callable between ticks. */
    emscripten_set_main_loop(tick, 0, 0);
#endif
    return 0;
}
