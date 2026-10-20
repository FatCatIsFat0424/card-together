import { defineConfig } from 'vitest/config';
import path from 'path';
import { svgLayersPlugin } from '../scripts/assets/vite-svg-layers.ts';

export default defineConfig({
  // Client modules under test import animated artwork as layers.
  plugins: [svgLayersPlugin()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
