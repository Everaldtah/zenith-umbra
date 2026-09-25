import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  define: { __ASSET_VER__: JSON.stringify(Date.now().toString(36)) },
  build: {
    target: 'es2022', chunkSizeWarningLimit: 1500,
    rollupOptions: { input: { site: resolve(import.meta.dirname, 'index.html'), play: resolve(import.meta.dirname, 'play.html'), film: resolve(import.meta.dirname, 'film.html') } },
  },
  test: { globals: true, include: ['tests/unit/**/*.test.ts'], testTimeout: 120000 },
} as any);
