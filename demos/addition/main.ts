/**
 * addition — pure-Tcl demo: sync runTcl('expr 1 + 1') returns "2" to JS.
 * Uses loadTcldide() WITHOUT {tk:true} — no em-x11 loaded.
 *
 * The base wasm exports tcldide_eval as a plain sync function (not JSPI-
 * wrapped), so runTcl returns directly without Promise trampolining.
 * tcldide_eval_async (JSPI-wrapped) backs runTclAsync for scripts that
 * need to suspend (vwait, blocking after).
 */

import { loadTcldide } from '../../src/tcldide.js';

const el = (id: string) => document.getElementById(id)!;

const tcldide = await loadTcldide();

el('status').innerHTML =
  `<span class="ok">Tcl ${tcldide.version} ready.</span> ` +
  `tkVersion=${tcldide.tkVersion ?? 'undefined'}, ` +
  `em=${tcldide.em ? 'PRESENT' : 'undefined'}.`;

const div = el('output');
div.hidden = false;

const lines: string[] = [];

// ---- sync runTcl ----

try {
  const r = tcldide.runTcl('expr 1 + 1');
  lines.push(`<span class="ok">runTcl('expr 1 + 1')</span> → "${r}"`);
} catch (e) {
  lines.push(`<span class="err">runTcl('expr 1 + 1') FAILED:</span> ${String(e)}`);
}

// ---- sync: multi-statement ----

try {
  const r = tcldide.runTcl('set a 40; set b 2; expr {$a + $b}');
  lines.push(`<span class="ok">runTcl('set a 40; set b 2; expr {$a + $b}')</span> → "${r}"`);
} catch (e) {
  lines.push(`<span class="err">runTcl multi-stmt FAILED:</span> ${String(e)}`);
}

// ---- async runTclAsync ----

try {
  await tcldide.runTclAsync('set x 7; set y 8');
  const r = await tcldide.runTclAsync('expr {$x * $y}');
  lines.push(`<span class="ok">runTclAsync('expr {$x * $y}')</span> → "${r}"`);
} catch (e) {
  lines.push(`<span class="err">runTclAsync FAILED:</span> ${String(e)}`);
}

div.innerHTML = lines.join('\n');

console.log('addition: Tcl', await tcldide.globals.get('tcl_version'));
console.log('em-x11 loaded:', tcldide.em ? 'YES' : 'NO');
