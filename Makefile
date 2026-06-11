# Build Tcl + Tk static archives for the tcldide-runtime cmake target.
#
# This Makefile is *only* the prep stage: download Tcl/Tk source, run their
# autoconf/configure under emconfigure, and produce libtcl8.6.a / libtk8.6.a
# under jsbuild/lib. The actual wasm runtime is built by `pnpm build:native`
# (cmake -> runtime/CMakeLists.txt), which links those archives plus
# libem_x11.a.
#
# Live targets (per setup.sh):
#   tcldideprep    download Tcl source (no source patch)
#   tkprep      download Tk source
#   config      configure Tcl
#   tcldideinstall build + install libtcl
#   tkinstall   build + install libtk (depends on em-x11 headers)
#   clean / distclean
#
# Tcl/Tk version pins -- bump together; em-x11's X11/*.h is matched to 8.6.
TCLVERSION?=8.6.15
TKVERSION?=8.6.15

INSTALLDIR=jsbuild
EMSCRIPTEN?=$(HOME)/.local/lib/emsdk/upstream/emscripten

# em-x11 Xlib replacement: Tk is compiled against em-x11's X11/*.h. The
# header dir must contain an X11/ subtree (matching Xlib's expected layout).
EM_X11_DIR?=$(CURDIR)/../em-x11
EM_X11_INCLUDES=$(EM_X11_DIR)/native/include
EM_X11_LIBDIR=$(EM_X11_DIR)/build/artifacts

# Optimisation injected into the Tcl/Tk Makefiles after configure runs.
BCFLAGS?=-Oz -s WASM=1

.PHONY: tcldideprep config tcldideinstall tkprep tkconfig libtk tkinstall tkclean clean distclean reset

# Stock Tcl 8.6 source. No `patch` step: every wasm-specific tweak lives
# in configure flags below (see config target). The tcldide-specific Tcl
# commands (`::tcldide::dom`, `::tcldide::jscall`) are compiled into the runtime
# executable from opt/tcldide.c, not into libtcl, so Tcl can stay pristine.
tcldideprep:
	mkdir -p ignored-area/tarballs ignored-area/third-party/tcl
	wget -nc -P ignored-area/tarballs http://prdownloads.sourceforge.net/tcl/tcl-core$(TCLVERSION)-src.tar.gz
	tar -C ignored-area/third-party/tcl --strip-components=1 -xf ignored-area/tarballs/tcl-core$(TCLVERSION)-src.tar.gz
	cd ignored-area/third-party/tcl/unix && autoconf

config:
	mkdir -p $(INSTALLDIR)
	# --host=wasm32-unknown-emscripten triggers autoconf's cross-compile
	# path so the runtime probes (strstr / strtoul / strtod broken-func
	# checks) are skipped instead of executed natively. Without this Tcl's
	# configure tries to AC_TRY_RUN them and fails under emconfigure.
	#
	# ac_cv_have_intrinsic_cpuid=no preempts tclUnixCompat.c's GNU/x86
	# cpuid feature detection -- there is no cpuid intrinsic on wasm32.
	# ac_cv_func_strtoul=yes: Tcl 8.6.15 added compat/strtoul.c, but emscripten
	# libc already exports strtoul. Without this override Tcl bundles its own
	# copy and wasm-ld errors with "duplicate symbol: strtoul" at runtime link.
	# tcl_cv_str*_unbroken=ok: cross-compile path defaults these to "unknown"
	# which Tcl treats as broken and pulls in compat/str{toul,str}.c. Same
	# duplicate-symbol fallout, so force them to "ok".
	cd ignored-area/third-party/tcl/unix && emconfigure ./configure \
		--host=wasm32-unknown-emscripten \
		--prefix=$(CURDIR)/$(INSTALLDIR) \
		--disable-threads --disable-load --disable-shared \
		ac_cv_have_intrinsic_cpuid=no \
		ac_cv_func_strtoul=yes \
		tcl_cv_strtoul_unbroken=ok \
		tcl_cv_strstr_unbroken=ok
	cd ignored-area/third-party/tcl/unix && sed -i 's/-O2//g' Makefile
	cd ignored-area/third-party/tcl/unix && sed -i 's/^\(CFLAGS\t.*\)/\1 $(BCFLAGS)/g' Makefile

# Build only the static archives, never tclsh -- tclsh is a native exe
# entry point that has no place in a browser build, and the install-binaries
# target would also try to install it. Manual cp instead of `make install`.
tcldideinstall:
	cd ignored-area/third-party/tcl/unix && emmake make -j libtcl8.6.a libtclstub8.6.a
	mkdir -p $(INSTALLDIR)/lib $(INSTALLDIR)/include
	cp ignored-area/third-party/tcl/unix/libtcl8.6.a ignored-area/third-party/tcl/unix/libtclstub8.6.a $(INSTALLDIR)/lib/
	cp ignored-area/third-party/tcl/unix/tclConfig.sh ignored-area/third-party/tcl/unix/tclooConfig.sh $(INSTALLDIR)/lib/ 2>/dev/null || true
	cp ignored-area/third-party/tcl/generic/tcl.h ignored-area/third-party/tcl/generic/tclDecls.h ignored-area/third-party/tcl/generic/tclPlatDecls.h \
		ignored-area/third-party/tcl/generic/tclTomMath.h ignored-area/third-party/tcl/generic/tclTomMathDecls.h \
		$(INSTALLDIR)/include/

# ---- Tk ---------------------------------------------------------------
# Stock Tk 8.6 against em-x11's Xlib. Tk's internal xlib/*.c is only used
# for Aqua builds (see unix/Makefile.in AQUA_OBJS), so --with-x keeps it
# out of the compile -- all X symbols stay unresolved in libtk.a and get
# filled by libem_x11.a at runtime link time. Prerequisites: tcldideinstall
# must have produced $(INSTALLDIR)/lib/libtcl8.6.a first, and em-x11
# must have been built (EM_X11_LIBDIR exists) at least for the header tree.

tkprep:
	mkdir -p ignored-area/tarballs ignored-area/third-party/tk
	wget -nc -P ignored-area/tarballs http://prdownloads.sourceforge.net/tcl/tk$(TKVERSION)-src.tar.gz
	tar -C ignored-area/third-party/tk --strip-components=1 -xf ignored-area/tarballs/tk$(TKVERSION)-src.tar.gz
	cd ignored-area/third-party/tk/unix && autoconf

tkconfig:
	@test -d "$(EM_X11_INCLUDES)/X11" || \
		(echo "em-x11 headers not found at $(EM_X11_INCLUDES)/X11"; exit 1)
	chmod +x scripts/xft-config 2>/dev/null || true
	cd ignored-area/third-party/tk/unix && \
		PATH="$(CURDIR)/scripts:$$PATH" \
		EM_X11_INCLUDES="$(EM_X11_INCLUDES)" \
		EM_X11_LIBDIR="$(EM_X11_LIBDIR)" \
		XFT_CFLAGS="-I$(EM_X11_INCLUDES)" \
		XFT_LIBS="-L$(EM_X11_LIBDIR) -lem_x11" \
		ac_cv_lib_Xft_XftFontOpen=yes \
		ac_cv_lib_fontconfig_FcFontSort=no \
		ac_cv_lib_X11_XkbKeycodeToKeysym=yes \
		cross_compiling=yes \
		emconfigure ./configure --prefix=$(CURDIR)/$(INSTALLDIR) \
		--host=wasm32-unknown-emscripten \
		--with-tcl=$(CURDIR)/$(INSTALLDIR)/lib \
		--x-includes=$(EM_X11_INCLUDES) \
		--x-libraries=$(EM_X11_LIBDIR) \
		--enable-xft \
		--disable-shared --disable-load --disable-threads
	# Strip optimisation flags the configure injects (same hack as Tcl's
	# config target) and make sure em-x11 headers win over anything the
	# configure probe stuck into X11_INCLUDES.
	cd ignored-area/third-party/tk/unix && sed -i 's/-O2//g' Makefile
	cd ignored-area/third-party/tk/unix && sed -i 's|^\(CFLAGS[[:space:]].*\)|\1 $(BCFLAGS) -DTK_USE_INPUT_METHODS=1|g' Makefile
	cd ignored-area/third-party/tk/unix && sed -i 's|^X11_INCLUDES[[:space:]]*=.*|X11_INCLUDES = -I$(EM_X11_INCLUDES)|' Makefile

libtk: tkconfig
	cd ignored-area/third-party/tk/unix && emmake make -j libtk8.6.a libtkstub8.6.a

# Install just the pieces the cmake runtime needs: the static archives
# and the header tree. Skip Tk's install-binaries because it transitively
# builds wish, which wants libem_x11 at link time -- wish only makes sense
# in a page with a Canvas attached, so we build that at the demo layer.
tkinstall: libtk
	mkdir -p $(INSTALLDIR)/lib $(INSTALLDIR)/include/tk
	cp ignored-area/third-party/tk/unix/libtk8.6.a ignored-area/third-party/tk/unix/libtkstub8.6.a $(INSTALLDIR)/lib/
	cp ignored-area/third-party/tk/unix/tkConfig.sh $(INSTALLDIR)/lib/
	cp ignored-area/third-party/tk/generic/tk.h ignored-area/third-party/tk/generic/tkDecls.h ignored-area/third-party/tk/generic/tkPlatDecls.h \
		ignored-area/third-party/tk/generic/tkIntXlibDecls.h $(INSTALLDIR)/include/tk/ 2>/dev/null || true
	cp ignored-area/third-party/tk/generic/*.h $(INSTALLDIR)/include/tk/

tkclean:
	if [ -e ignored-area/third-party/tk/unix/Makefile ] ; then cd ignored-area/third-party/tk/unix && make distclean ; fi
	rm -f $(INSTALLDIR)/lib/libtk8.6.a $(INSTALLDIR)/lib/tkConfig.sh

clean:
	rm -rf $(INSTALLDIR)
	if [ -e ignored-area/third-party/tcl/unix/Makefile ] ; then cd ignored-area/third-party/tcl/unix && make clean ; fi
	if [ -e ignored-area/third-party/tk/unix/Makefile ] ; then cd ignored-area/third-party/tk/unix && make clean ; fi

distclean:
	rm -rf $(INSTALLDIR)
	if [ -e ignored-area/third-party/tcl/unix/Makefile ] ; then cd ignored-area/third-party/tcl/unix && make distclean ; fi
	if [ -e ignored-area/third-party/tk/unix/Makefile ] ; then cd ignored-area/third-party/tk/unix && make distclean ; fi

reset:
	@read -p "This nukes ignored-area/third-party/, are you sure? Type 'YES I am sure' if so: " P && [ "$$P" = "YES I am sure" ]
	rm -rf ignored-area tcl tk $(INSTALLDIR)
