import { defineConfig } from 'vite';
import type { Plugin, ResolvedServerUrls } from 'vite';
import { resolve } from 'node:path';
import { readdirSync, statSync, existsSync } from 'node:fs';

/**
 * Auto-discovers examples/<name>/index.html entries and prints their URLs
 * after Vite's own "Local" / "Network" URL block. Same pattern as em-x11.
 */
function listDemoEntries(): { name: string; path: string }[] {
  const examplesDir = resolve(__dirname, 'examples');
  if (!existsSync(examplesDir)) return [];
  return readdirSync(examplesDir)
    .filter((name) => {
      const entry = resolve(examplesDir, name, 'index.html');
      return statSync(resolve(examplesDir, name)).isDirectory() && existsSync(entry);
    })
    .map((name) => ({ name, path: `/examples/${name}/` }));
}

function printDemoUrls(): Plugin {
  const examples = listDemoEntries();
  return {
    name: 'tcldide-print-demo-urls',
    configureServer(server) {
      const originalPrint = server.printUrls.bind(server);
      server.printUrls = () => {
        originalPrint();
        if (examples.length === 0) return;
        const urls: ResolvedServerUrls | null = server.resolvedUrls;
        const bases = urls ? [...urls.local, ...urls.network] : [];
        const base = bases[0]?.replace(/\/$/, '') ?? '';
        // eslint-disable-next-line no-console
        console.log('\n  \x1b[1mExamples\x1b[0m:');
        for (const d of examples) {
          // eslint-disable-next-line no-console
          console.log(`    \x1b[36m${d.name.padEnd(10)}\x1b[0m ${base}${d.path}`);
        }
        // eslint-disable-next-line no-console
        console.log('');
      };
    },
  };
}

export default defineConfig({
  root: '.',

  plugins: [printDemoUrls()],

  server: {
    fs: {
      // Allow serving our own build outputs plus the sibling em-x11 tree.
      allow: ['.', 'build', '../em-x11'],
    },
    // Port left unset -- Vite picks 5173, auto-bumps on collision if em-x11's
    // own dev server is already running.
  },

  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: Object.fromEntries(
        [
          ['main', resolve(__dirname, 'index.html')],
          ...listDemoEntries().map((d) => [d.name, resolve(__dirname, `examples/${d.name}/index.html`)]),
        ],
      ),
    },
  },

  assetsInclude: ['**/*.wasm'],
});
