import { build } from 'esbuild';

await build({
  entryPoints: ['src/browser/index.ts'],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  outfile: 'browser/out/browser/index.mjs',
  external: ['web-tree-sitter', 'prettier', 'vscode-languageserver-textdocument'],
  sourcemap: true,
});
