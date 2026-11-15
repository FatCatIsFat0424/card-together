import { defineConfig } from 'vitest/config';
import path from 'path';
import { svgLayersPlugin } from '../scripts/assets/vite-svg-layers.ts';
import { BalancedShardSequencer } from './tests/helpers/shard-sequencer.ts';

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
    // CI runs the files in shards; balance them by estimated time instead of path hash.
    sequence: { sequencer: BalancedShardSequencer },
  },
});
