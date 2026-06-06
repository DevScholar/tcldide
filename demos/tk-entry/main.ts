/**
 * tk-entry: XIM smoke test for em-x11.
 *
 * Validates the Tier A text-input path:
 *
 *   - Typing ASCII into a Tk `entry` works (tkUnixKey.c → Xutf8LookupString
 *     → side-channel UTF-8 from the JS keydown handler).
 *   - Submitting via <Return> reads `[.e get]` and echoes it back to a
 *     label, proving the chars are actually in the entry's content var.
 *   - The OS IME's candidate window anchors near the X caret (XSetICValues
 *     XNSpotLocation → host text-input.ts → hidden textarea position).
 *     Verify by typing Chinese / Japanese with a system IME and watching
 *     the candidate strip appear next to the entry, not the screen corner.
 *   - A Tk `text` widget exercises the multi-line path (same code, but
 *     also handles BackSpace/Return/Arrow keysyms via the keysym path).
 */

import { loadTcldide } from '../../src/tcldide.js';

const tcldide = await loadTcldide();

await tcldide.runTcl(`
  label .title -text {Tk entry — XIM smoke test} -font {Helvetica 13 bold} -pady 6
  pack  .title -fill x

  frame .row -padx 8 -pady 6
  label .row.l -text "Type here:" -anchor e -width 12
  entry .row.e -width 30
  pack  .row.l .row.e -side left -padx 4
  pack  .row -fill x

  label .echo -text "(press Return in the entry)" \\
    -relief groove -bd 2 -padx 8 -pady 4 -width 40 \\
    -anchor w -justify left
  pack  .echo -padx 8 -pady 4

  label .info -text "Multi-line:" -anchor w -padx 8
  pack  .info -fill x
  text  .t -width 40 -height 5
  pack  .t -padx 8 -pady 4
  .t insert end "Type here too. ASCII works in Tier A;\\nIME-composed text arrives on commit."

  bind .row.e <Return> {
    .echo configure -text "got: [.row.e get]"
  }

  focus .row.e
`);

console.log(`tk-entry: Tcl ${tcldide.version} / Tk ${tcldide.tkVersion} ready`);

(window as any).tcldide = tcldide;
