# tcldide-runtime: the generic Tk wasm that the JS API drives.
#
# Mirrors demos/tk-hello/CMakeLists.txt's prereq guards but builds a
# headless runtime: no hardcoded Tcl script, all evaluation comes from
# JS via cwrap'd entry points.

set(TCLDIDE_DIR "${CMAKE_SOURCE_DIR}/jsbuild")
set(TCL_ARCHIVE "${TCLDIDE_DIR}/lib/libtcl8.6.a")
set(TK_ARCHIVE  "${TCLDIDE_DIR}/lib/libtk8.6.a")

set(TCL_LIBRARY_DIR "${CMAKE_SOURCE_DIR}/tcl/library")
set(TK_LIBRARY_DIR  "${CMAKE_SOURCE_DIR}/tk/library")

set(EMX11_DIR        "${CMAKE_SOURCE_DIR}/../em-x11")
set(EMX11_BUILD_DIR  "${EMX11_DIR}/build")
set(EMX11_LIB_DIR    "${EMX11_BUILD_DIR}/artifacts")

# em-x11 linking goes through the emscripten-ports script at
# tools/ports/emx11.py. It returns the full archive paths to emcc,
# bypassing emscripten's -lX11 -> libxlib.js hijack, and provides
# include paths via process_args(). The port finds pre-built archives
# in build/artifacts/; the add_custom_command below ensures they're
# ready before tcldide-runtime links.
set(_port_script "${EMX11_DIR}/tools/ports/emx11.py")

# em-x11's JS bridges are embedded in libX11.a via EM_JS (see
# em-x11/native/emx11/bridges.c). The port script returns the full
# archive paths; emcc's post-link pass picks up the __em_js__* data
# symbols automatically. The prereq guard checks for em-x11's cmake
# configure marker — the add_custom_command above builds everything.

if(NOT EXISTS "${TCL_ARCHIVE}" OR NOT EXISTS "${TK_ARCHIVE}")
    message(STATUS "tcldide-runtime: skipping -- ${TCL_ARCHIVE} or ${TK_ARCHIVE} missing.")
    return()
endif()
if(NOT EXISTS "${TCL_LIBRARY_DIR}/init.tcl" OR NOT EXISTS "${TK_LIBRARY_DIR}/tk.tcl")
    message(STATUS "tcldide-runtime: skipping -- Tcl/Tk script library missing.")
    return()
endif()
if(NOT EXISTS "${EMX11_BUILD_DIR}/CMakeCache.txt")
    message(STATUS "tcldide-runtime: skipping -- em-x11 not configured at ${EMX11_BUILD_DIR}. Run `cd ../em-x11 && pnpm build:native` (or `emcmake cmake -S . -B build`) once to bootstrap.")
    return()
endif()

# Drive em-x11's own build whenever the tcldide runtime is rebuilt. We
# share em-x11's `build/` (rather than a private copy like pyodide-tk
# uses) so a single `pnpm build:native` over there primes everyone, and
# repeated tcldide builds get em-x11's own incremental dep tracking for
# free. CONFIGURE_DEPENDS on the source glob keeps CMake reconfiguring
# tcldide when files are added/removed; the inner `cmake --build` no-ops
# when nothing changed (~tens of ms), so unconditionally running it on
# every tcldide build is cheap. Without this hook, editing em-x11 C
# sources required a manual `pnpm build:native` over there first --
# stale archives silently linked into tcldide-runtime and produced
# "fix doesn't take effect" bugs (compare project_pyodide_tk_stage_assets
# memory: same shape on the pyodide-tk side, solved differently).
file(GLOB_RECURSE EMX11_SRC CONFIGURE_DEPENDS
    "${EMX11_DIR}/native/dix/*.c"
    "${EMX11_DIR}/native/emx11/*.c"
    "${EMX11_DIR}/native/emx11/*.h"
    "${EMX11_DIR}/native/Xext/*.c"
    "${EMX11_DIR}/native/render/*.c"
    "${EMX11_DIR}/native/xkb/*.c"
    "${EMX11_DIR}/native/glx/*.c"
    "${EMX11_DIR}/native/include/*.h"
)
add_custom_command(
    OUTPUT "${EMX11_LIB_DIR}/libX11.a"
    COMMAND ${CMAKE_COMMAND} --build "${EMX11_BUILD_DIR}"
    DEPENDS ${EMX11_SRC}
    COMMENT "Building em-x11 (port finds archives in ${EMX11_LIB_DIR})"
    VERBATIM
)
add_custom_target(emx11_static_build DEPENDS "${EMX11_LIB_DIR}/libX11.a")

add_executable(tcldide-runtime
    tcldide-runtime.c
    "${CMAKE_SOURCE_DIR}/opt/tcldide.c"
)
add_dependencies(tcldide-runtime emx11_static_build)

target_include_directories(tcldide-runtime PRIVATE
    "${TCLDIDE_DIR}/include"
    "${TCLDIDE_DIR}/include/tk"
    "${EMX11_DIR}/native/include"
)

target_link_libraries(tcldide-runtime PRIVATE
    "${TK_ARCHIVE}"
    "${TCL_ARCHIVE}"
)

target_compile_options(tcldide-runtime PRIVATE
    ${TCLDIDE_WARN_FLAGS}
)

target_link_options(tcldide-runtime PRIVATE
    "SHELL:--use-port=${_port_script}"
    "SHELL:-s MODULARIZE=1"
    "SHELL:-s EXPORT_ES6=1"
    "SHELL:-s EXPORT_NAME=createTcldideRuntime"
    "SHELL:-s ASYNCIFY=1"
    "SHELL:-s ENVIRONMENT=web"
    "SHELL:--pre-js ${CMAKE_CURRENT_SOURCE_DIR}/pre-env.js"
    "SHELL:-s ALLOW_MEMORY_GROWTH=1"
    "SHELL:-s FORCE_FILESYSTEM=1"
    "SHELL:-s EXPORTED_RUNTIME_METHODS=['ccall','cwrap','UTF8ToString','FS','stringToUTF8','lengthBytesUTF8']"
    "SHELL:-s EXPORTED_FUNCTIONS=['_main','_tcldide_eval','_tcldide_result','_tcldide_get_var','_tcldide_set_var','_tcldide_push_key_text','_emx11_push_button_event','_emx11_push_motion_event','_emx11_push_key_event','_emx11_push_key_event_kc','_emx11_install_keysym','_emx11_push_expose_event','_emx11_push_map_request','_emx11_push_reparent_notify','_malloc','_free']"
    "SHELL:-Wl,--error-limit=0"
    # --profiling-funcs: keep wasm function names through wasm-opt so
    # browser stacks show C symbols instead of $func1234 indices.
    # No DWARF, no source lines — just names. ~200KB to .wasm, no
    # runtime cost. (-g2 alone gets stripped by wasm-opt.)
    "SHELL:--profiling-funcs"
    "SHELL:--preload-file ${TCL_LIBRARY_DIR}@/tcl"
    "SHELL:--preload-file ${TK_LIBRARY_DIR}@/tk"
)

set_target_properties(tcldide-runtime PROPERTIES
    SUFFIX ".js"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/artifacts/tcldide-runtime"
)
