import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');

/** @type {esbuild.BuildOptions} */
const sharedOptions = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  platform: 'node',
  target: 'node18',
  external: ['vscode'],
};

// Bundle the client (CJS for VS Code extension API)
await esbuild.build({
  ...sharedOptions,
  format: 'cjs',
  entryPoints: ['client/src/extension.ts'],
  outfile: 'client/out/extension.js',
});

// Bundle the server (ESM to support web-tree-sitter's import.meta.url)
await esbuild.build({
  ...sharedOptions,
  format: 'esm',
  entryPoints: ['server/src/server.ts'],
  outfile: 'server/out/server.mjs',
  banner: {
    js: `
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
`,
  },
});

console.log('Build complete');
