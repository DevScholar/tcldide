/**
 * widget-gallery demo: loads tcldide, fetches the standalone
 * widget_gallery.tcl, and evaluates it via the standard runTcl API.
 */

import { loadTcldide } from '../../src/tcldide.js';

const tcldide = await loadTcldide();

const resp = await fetch(new URL('widget_gallery.tcl', import.meta.url).href);
const tclCode = await resp.text();
tcldide.runTcl(tclCode);

console.log(`widget-gallery: Tcl ${tcldide.version} / Tk ${tcldide.tkVersion} ready`);

(window as any).tcldide = tcldide;
