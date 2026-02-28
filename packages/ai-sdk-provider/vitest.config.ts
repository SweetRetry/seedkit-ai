import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    exclude: ['tmp/**', 'node_modules/**'],
  },
});
