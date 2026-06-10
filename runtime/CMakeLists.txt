# tcldide-runtime: two wasm targets from shared C source.
#
#   tcldide-runtime-base  — Tcl only (no Tk, no em-x11)
#   tcldide-runtime-tk    — Tcl + Tk + em-x11 (full GUI stack)
#
# The C source (tcldide-runtime.c) uses #ifdef WITH_TK to gate all
# Tk-specific code. The base target does NOT define WITH_TK and links
# only libtcl8.6.a + tcl-poll.c (a minimal poll/select override with
# zero em-x11 dependencies). The Tk target defines WITH_TK, links the
# full em-x11 port, and produces the same artifact shape as before.

set(TCLDIDE_DIR "${CMAKE_SOURCE_DIR}/jsbuild")
set(TCL_ARCHIVE "${TCLDIDE_DIR}/lib/libtcl8.6.a")
set(TK_ARCHIVE  "${TCLDIDE_DIR}/lib/libtk8.6.a")

set(TCL_LIBRARY_DIR "${CMAKE_SOURCE_DIR}/ignored-area/third-party/tcl/library")
set(TK_LIBRARY_DIR  "${CMAKE_SOURCE_DIR}/ignored-area/third-party/tk/library")

set(EMX11_DIR        "${CMAKE_SOURCE_DIR}/../em-x11")
set(EMX11_BUILD_DIR  "${EMX11_DIR}/build")
set(EMX11_LIB_DIR    "${EMX11_BUILD_DIR}/artifacts")
set(_port_script     "${EMX11_DIR}/tools/ports/emx11.py")

# ---- prereq guard (shared) ------------------------------------------------

if(NOT EXISTS "${TCL_ARCHIVE}")
    message(STATUS "tcldide-runtime: skipping — ${TCL_ARCHIVE} missing.")
    return()
endif()
if(NOT EXISTS "${TCL_LIBRARY_DIR}/init.tcl")
    message(STATUS "tcldide-runtime: skipping — Tcl script library missing.")
    return()
endif()

# ===========================================================================
# Target 1: tcldide-runtime-base  (Tcl-only, no em-x11)
# ===========================================================================

add_executable(tcldide-runtime-base
    tcldide-runtime.c
    tcl-poll.c
    "${CMAKE_SOURCE_DIR}/opt/tcldide.c"
)

target_include_directories(tcldide-runtime-base PRIVATE
    "${TCLDIDE_DIR}/include"
)

target_link_libraries(tcldide-runtime-base PRIVATE
    "${TCL_ARCHIVE}"
)

target_compile_options(tcldide-runtime-base PRIVATE
    ${TCLDIDE_WARN_FLAGS}
)

target_link_options(tcldide-runtime-base PRIVATE
    "SHELL:-s MODULARIZE=1"
    "SHELL:-s EXPORT_ES6=1"
    "SHELL:-s EXPORT_NAME=createTcldideRuntimeBase"
    "SHELL:-s JSPI=1"
    "SHELL:-s ENVIRONMENT=web"
    "SHELL:--pre-js ${CMAKE_CURRENT_SOURCE_DIR}/pre-env.js"
    "SHELL:-s ALLOW_MEMORY_GROWTH=1"
    "SHELL:-s FORCE_FILESYSTEM=1"
    "SHELL:-s EXPORTED_RUNTIME_METHODS=['ccall','cwrap','UTF8ToString','FS','stringToUTF8','lengthBytesUTF8']"
    "SHELL:-s EXPORTED_FUNCTIONS=['_main','_tcldide_eval','_tcldide_eval_async','_tcldide_result','_tcldide_get_var','_tcldide_set_var','_malloc','_free']"
    "SHELL:-s JSPI_EXPORTS='main,__main_argc_argv,tcldide_eval_async'"
    "SHELL:-Wl,--error-limit=0"
    "SHELL:--profiling-funcs"
    "SHELL:--preload-file ${TCL_LIBRARY_DIR}@/tcl"
)

set_target_properties(tcldide-runtime-base PROPERTIES
    SUFFIX ".js"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/artifacts/tcldide-runtime-base"
)

# ===========================================================================
# Target 2: tcldide-runtime-tk  (Tcl + Tk + em-x11, full GUI stack)
# ===========================================================================

if(NOT EXISTS "${TK_ARCHIVE}")
    message(STATUS "tcldide-runtime-tk: skipping — ${TK_ARCHIVE} missing. Run `make tkinstall` first.")
    return()
endif()
if(NOT EXISTS "${TK_LIBRARY_DIR}/tk.tcl")
    message(STATUS "tcldide-runtime-tk: skipping — Tk script library missing.")
    return()
endif()
if(NOT EXISTS "${EMX11_BUILD_DIR}/CMakeCache.txt")
    message(STATUS "tcldide-runtime-tk: skipping — em-x11 not configured at ${EMX11_BUILD_DIR}. Run `cd ../em-x11 && pnpm build:native` once to bootstrap.")
    return()
endif()

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

add_executable(tcldide-runtime-tk
    tcldide-runtime.c
    "${CMAKE_SOURCE_DIR}/opt/tcldide.c"
)
add_dependencies(tcldide-runtime-tk emx11_static_build)

target_compile_definitions(tcldide-runtime-tk PRIVATE
    WITH_TK
)

target_include_directories(tcldide-runtime-tk PRIVATE
    "${TCLDIDE_DIR}/include"
    "${TCLDIDE_DIR}/include/tk"
    "${EMX11_DIR}/native/include"
)

target_link_libraries(tcldide-runtime-tk PRIVATE
    "${TK_ARCHIVE}"
    "${TCL_ARCHIVE}"
)

target_compile_options(tcldide-runtime-tk PRIVATE
    ${TCLDIDE_WARN_FLAGS}
)

target_link_options(tcldide-runtime-tk PRIVATE
    "SHELL:--use-port=${_port_script}"
    "SHELL:-s MODULARIZE=1"
    "SHELL:-s EXPORT_ES6=1"
    "SHELL:-s EXPORT_NAME=createTcldideRuntimeTk"
    "SHELL:-s JSPI=1"
    "SHELL:-s ENVIRONMENT=web"
    "SHELL:--pre-js ${CMAKE_CURRENT_SOURCE_DIR}/pre-env.js"
    "SHELL:-s ALLOW_MEMORY_GROWTH=1"
    "SHELL:-s FORCE_FILESYSTEM=1"
    "SHELL:-s EXPORTED_RUNTIME_METHODS=['ccall','cwrap','UTF8ToString','FS','stringToUTF8','lengthBytesUTF8']"
    "SHELL:-s EXPORTED_FUNCTIONS=['_main','_tick','_tcldide_eval','_tcldide_result','_tcldide_get_var','_tcldide_set_var','_tcldide_push_key_text','_emx11_push_button_event','_emx11_push_motion_event','_emx11_push_key_event','_emx11_push_key_event_kc','_emx11_install_keysym','_emx11_push_expose_event','_emx11_push_map_request','_emx11_push_reparent_notify','_malloc','_free']"
    "SHELL:-s JSPI_EXPORTS='tick,main,__main_argc_argv,tcldide_eval'"
    "SHELL:-Wl,--error-limit=0"
    "SHELL:--profiling-funcs"
    "SHELL:--preload-file ${TCL_LIBRARY_DIR}@/tcl"
    "SHELL:--preload-file ${TK_LIBRARY_DIR}@/tk"
)

set_target_properties(tcldide-runtime-tk PROPERTIES
    SUFFIX ".js"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/artifacts/tcldide-runtime-tk"
)
