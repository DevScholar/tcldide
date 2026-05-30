/*
 * tcldide-runtime -- generic Tcl/Tk wasm runtime exposing a Pyodide-style
 * JS API. main() initialises Tcl + Tk + the browser notifier and returns;
 * the runtime stays alive (noExitRuntime). All evaluation happens through
 * cwrap'd entry points the JS loader calls:
 *
 *   tcldide_eval        -- Tcl_Eval into a private result slot.
 *   tcldide_result      -- last captured result (or errorInfo on TCL_ERROR).
 *   tcldide_get_var     -- Tcl_GetVar in global scope.
 *   tcldide_set_var     -- Tcl_SetVar in global scope.
 *   tcldide_do_one_event-- pump the Tcl/Tk event queue once (TCL_DONT_WAIT).
 *
 * The browser notifier is the same shape as demos/tk-hello/tk-hello.c:
 * yield to the browser per-tick and pump every registered fd handler so
 * Tk's X-fd DisplayFileProc actually runs. See
 * project_tk_browser_notifier in memory for the full why.
 */

#include <tcl.h>
#include <tk.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <emscripten.h>

extern int Tcldide_Init(Tcl_Interp *interp);
extern void emx11_install_browser_notifier(void);

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

EMSCRIPTEN_KEEPALIVE
int tcldide_eval(const char *code) {
    if (!g_interp) { set_result("tcldide: interp not initialised"); return TCL_ERROR; }
    Tcl_DString ds;
    const char *cesu = to_cesu8(code, &ds);
    int rc = Tcl_Eval(g_interp, cesu);
    Tcl_DStringFree(&ds);
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

/* Pump the event queue until it's drained. JS drives this on
 * requestAnimationFrame; one tick processes everything Tcl/Tk has
 * outstanding (window realize, geometry, expose, idle redraws,
 * after-timers due now) before yielding back to the browser. The
 * original tight C loop did this implicitly at ~1ms per event; if
 * we processed only one event per RAF tick we'd be at ~16ms each
 * and a typical demo's 30+ widgets would visibly load over several
 * seconds. We pin the flag combo here so the JS side doesn't have
 * to duplicate Tcl's bit definitions and get them wrong --
 * `TCL_ALL_EVENTS = ~TCL_DONT_WAIT` is a sign-extended ~0, which is
 * easy to misencode as 0x1f and silently drop TCL_IDLE_EVENTS (0x20). */
EMSCRIPTEN_KEEPALIVE
int tcldide_do_one_event(void) {
    if (!g_interp) return 0;
    int processed = 0;
    /* Cap at 256 to bound a single tick: a runaway `after 0` chain
     * shouldn't pin the main thread forever. 256 events is more than
     * any normal widget realize round-trip needs. */
    for (int i = 0; i < 256; i++) {
        if (!Tcl_DoOneEvent(TCL_ALL_EVENTS | TCL_DONT_WAIT)) break;
        processed++;
    }
    return processed;
}

int main(int argc, char **argv) {
    (void)argc; (void)argv;

    emx11_install_browser_notifier();

    setenv("TCL_LIBRARY", "/tcl", 1);
    setenv("TK_LIBRARY",  "/tk",  1);
    setenv("DISPLAY",     ":0",   1);

    Tcl_FindExecutable("tcldide-runtime");
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

    /* Belt-and-braces: source auto.tcl so tcl_findLibrary is loaded
     * before Tk_Init asks for it. */
    Tcl_Eval(g_interp, "catch {source /tcl/auto.tcl}");

    if (Tk_Init(g_interp) != TCL_OK) {
        fprintf(stderr, "tcldide-runtime: Tk_Init failed: %s\n",
                Tcl_GetStringResult(g_interp));
        return 1;
    }

    /* Force one update so Tk's main window realises before the first
     * user eval has a chance to pack widgets. Without this, the first
     * `pack` call against `.` runs before the wrapper is mapped and
     * the toplevel paints with stale geometry. */
    Tcl_Eval(g_interp, "update");
    set_result("");

    /* Module.noExitRuntime keeps the runtime alive after this returns
     * so the cwrap'd entry points remain callable. */
    return 0;
}
