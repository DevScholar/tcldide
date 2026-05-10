/*
 * wacl-tk-runtime -- generic Tcl/Tk wasm runtime exposing a Pyodide-style
 * JS API. main() initialises Tcl + Tk + the browser notifier and returns;
 * the runtime stays alive (noExitRuntime). All evaluation happens through
 * cwrap'd entry points the JS loader calls:
 *
 *   wacl_eval        -- Tcl_Eval into a private result slot.
 *   wacl_result      -- last captured result (or errorInfo on TCL_ERROR).
 *   wacl_get_var     -- Tcl_GetVar in global scope.
 *   wacl_set_var     -- Tcl_SetVar in global scope.
 *   wacl_do_one_event-- pump the Tcl/Tk event queue once (TCL_DONT_WAIT).
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

extern int Wacl_Init(Tcl_Interp *interp);

#define MAX_FILE_HANDLERS 8
typedef struct {
    int fd;
    int mask;
    Tcl_FileProc *proc;
    ClientData cd;
    int in_use;
} FileHandler;
static FileHandler g_handlers[MAX_FILE_HANDLERS];

static void track_CreateFileHandler(int fd, int mask, Tcl_FileProc *proc, ClientData cd) {
    for (int i = 0; i < MAX_FILE_HANDLERS; i++) {
        if (g_handlers[i].in_use && g_handlers[i].fd == fd) {
            g_handlers[i].mask = mask;
            g_handlers[i].proc = proc;
            g_handlers[i].cd   = cd;
            return;
        }
    }
    for (int i = 0; i < MAX_FILE_HANDLERS; i++) {
        if (!g_handlers[i].in_use) {
            g_handlers[i].in_use = 1;
            g_handlers[i].fd   = fd;
            g_handlers[i].mask = mask;
            g_handlers[i].proc = proc;
            g_handlers[i].cd   = cd;
            return;
        }
    }
    fprintf(stderr, "wacl-tk: file handler table full (fd=%d dropped)\n", fd);
}

static void track_DeleteFileHandler(int fd) {
    for (int i = 0; i < MAX_FILE_HANDLERS; i++) {
        if (g_handlers[i].in_use && g_handlers[i].fd == fd) {
            g_handlers[i].in_use = 0;
            return;
        }
    }
}

static void  nop_SetTimer(const Tcl_Time *t)        { (void)t; }
static void *nop_InitNotifier(void)                 { return (void *)1; }
static void  nop_FinalizeNotifier(ClientData cd)    { (void)cd; }
static void  nop_AlertNotifier(ClientData cd)       { (void)cd; }
static void  nop_ServiceModeHook(int mode)          { (void)mode; }

static int yield_WaitForEvent(const Tcl_Time *timePtr) {
    /* timePtr == NULL means block-until-event; timePtr->{0,0} means
     * poll. We must NOT yield to JS on the poll path: the JS loader
     * polls every animation frame to keep Tk responsive, and yielding
     * from inside a synchronous user runTcl() would let the JS-side
     * pump re-enter wasm and corrupt Asyncify state. Drain the
     * registered fd handlers either way -- that's how Tk's
     * DisplayFileProc consumes em-x11 events without us ever sleeping. */
    int polling = (timePtr && timePtr->sec == 0 && timePtr->usec == 0);
    if (!polling) {
        emscripten_sleep(1);
    }
    for (int i = 0; i < MAX_FILE_HANDLERS; i++) {
        if (g_handlers[i].in_use && (g_handlers[i].mask & TCL_READABLE)) {
            g_handlers[i].proc(g_handlers[i].cd, TCL_READABLE);
        }
    }
    return 0;
}

static void install_browser_notifier(void) {
    Tcl_NotifierProcs procs;
    procs.setTimerProc           = nop_SetTimer;
    procs.waitForEventProc       = yield_WaitForEvent;
    procs.createFileHandlerProc  = track_CreateFileHandler;
    procs.deleteFileHandlerProc  = track_DeleteFileHandler;
    procs.initNotifierProc       = nop_InitNotifier;
    procs.finalizeNotifierProc   = nop_FinalizeNotifier;
    procs.alertNotifierProc      = nop_AlertNotifier;
    procs.serviceModeHookProc    = nop_ServiceModeHook;
    Tcl_SetNotifier(&procs);
}

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
int wacl_eval(const char *code) {
    if (!g_interp) { set_result("wacl: interp not initialised"); return TCL_ERROR; }
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
const char *wacl_result(void) {
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
const char *wacl_get_var(const char *name) {
    if (!g_interp) return NULL;
    Tcl_DString name_ds;
    const char *cesu_name = to_cesu8(name, &name_ds);
    const char *val = Tcl_GetVar(g_interp, cesu_name, TCL_GLOBAL_ONLY);
    Tcl_DStringFree(&name_ds);
    return stash_var_result(val);
}

EMSCRIPTEN_KEEPALIVE
const char *wacl_set_var(const char *name, const char *value) {
    if (!g_interp) return NULL;
    Tcl_DString name_ds, val_ds;
    const char *cesu_name = to_cesu8(name, &name_ds);
    const char *cesu_val  = to_cesu8(value, &val_ds);
    const char *result = Tcl_SetVar(g_interp, cesu_name, cesu_val, TCL_GLOBAL_ONLY);
    Tcl_DStringFree(&name_ds);
    Tcl_DStringFree(&val_ds);
    return stash_var_result(result);
}

/* em-x11's `Xutf8LookupString` honours its X11 spec contract and returns
 * standard 4-byte UTF-8. Tk 8.6 (TCL_UTF_MAX=3) however needs CESU-8
 * surrogate pairs in entry/text storage -- Stock Tk's tkUnixKey.c
 * `TkpGetString` zero-converts the bytes from XIM, which is a stock
 * Tk bug that surfaces as `DeleteChars` byte-stride mismatch and a
 * `Tcl_Alloc` underflow on the next backspace.
 *
 * Rather than patching upstream Tk or breaking em-x11's X11 contract,
 * we intercept the keypress text at this wacl-tk-only seam: launch.ts
 * rebinds Module._emx11_set_pending_key_text to point at this wrapper,
 * which converts the JS-staged UTF-8 to CESU-8 before forwarding to the
 * real `emx11_set_pending_key_text`. Other em-x11 wasm clients keep
 * their unmodified UTF-8 path. */
extern void emx11_set_pending_key_text(const char *utf8);

EMSCRIPTEN_KEEPALIVE
void wacl_push_key_text(const char *utf8) {
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
int wacl_do_one_event(void) {
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

    install_browser_notifier();

    setenv("TCL_LIBRARY", "/tcl", 1);
    setenv("TK_LIBRARY",  "/tk",  1);
    setenv("DISPLAY",     ":0",   1);

    Tcl_FindExecutable("wacl-tk-runtime");
    g_interp = Tcl_CreateInterp();
    if (!g_interp) {
        fprintf(stderr, "wacl-tk-runtime: Tcl_CreateInterp failed\n");
        return 1;
    }

    if (Tcl_Init(g_interp) != TCL_OK) {
        fprintf(stderr, "wacl-tk-runtime: Tcl_Init failed: %s\n",
                Tcl_GetStringResult(g_interp));
        return 1;
    }

    /* Register ::wacl::dom and ::wacl::jscall (opt/wacl.c). Failures
     * here are non-fatal -- a runtime without the JS bridge can still
     * eval pure-Tcl/Tk code. */
    if (Wacl_Init(g_interp) != TCL_OK) {
        fprintf(stderr, "wacl-tk-runtime: Wacl_Init failed: %s\n",
                Tcl_GetStringResult(g_interp));
    }

    /* Belt-and-braces: source auto.tcl so tcl_findLibrary is loaded
     * before Tk_Init asks for it. */
    Tcl_Eval(g_interp, "catch {source /tcl/auto.tcl}");

    if (Tk_Init(g_interp) != TCL_OK) {
        fprintf(stderr, "wacl-tk-runtime: Tk_Init failed: %s\n",
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
