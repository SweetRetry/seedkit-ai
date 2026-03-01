import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node18',
  clean: true,
  sourcemap: false,
  minify: false,
  // Bundle the provider (no published dist with correct ESM extensions).
  // @seedkit-ai/tools is NOT bundled — it has its own tsup dist and its transitive
  // jsdom dep is CJS-only which breaks when bundled into ESM.
  noExternal: ['@seedkit-ai/ai-sdk-provider'],
  onSuccess: 'chmod +x dist/index.js',
});
