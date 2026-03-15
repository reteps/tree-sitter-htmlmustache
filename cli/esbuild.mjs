import { build } from 'esbuild';

await build({
  entryPoints: ['cli/src/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: 'cli/out/main.js',
  banner: { js: '#!/usr/bin/env node' },
  external: ['web-tree-sitter', 'editorconfig', 'tree-sitter', 'prettier'],
});
