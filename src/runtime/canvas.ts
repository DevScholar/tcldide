/**
 * canvas — Pyodide-style accessor for the canvas Tk paints into.
 * Just reads em.display.canvas; the canvas itself is owned by em-x11.
 */

import type { EmX11 } from '../../../em-x11/src/index.js';

export interface WaclTkCanvas {
  getCanvas2D(): HTMLCanvasElement;
}

export function makeCanvas(em: EmX11): WaclTkCanvas {
  return {
    getCanvas2D: () => em.display.canvas as HTMLCanvasElement,
  };
}
