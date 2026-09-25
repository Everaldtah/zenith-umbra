// Tool runs (diagnostics, fixture generators) - not part of `npm test`:  npx vitest run -c tests/tools/vitest.config.ts <file>
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { globals: true, root: '.', include: ['tests/tools/**/*.test.ts'], testTimeout: 600000 } });
