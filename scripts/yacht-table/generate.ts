// Solves Yacht Dice solitaire and writes the table the bot reads (server/src/bots/yacht-table.bin).
// Usage: npm run yacht:table   (about 30 seconds)
import { writeFileSync } from 'node:fs';
import { YACHT_MEAN_SCALE, YACHT_SPREAD_SCALE, YACHT_TABLE_BYTES, YACHT_TABLE_PATH } from '../../server/src/bots/yacht-table';
import { YACHT_STATE_COUNT } from '../../server/src/bots/yacht-states';
import { solveTable } from './solve';

const { mean, second } = solveTable((filled) => console.error(`solved states with ${filled} boxes filled`));
const bytes = new Uint8Array(YACHT_TABLE_BYTES);
const view = new DataView(bytes.buffer);
let largestSpread = 0;
for (let index = 0; index < YACHT_STATE_COUNT; index += 1) {
  const quantized = Math.round(mean[index] * YACHT_MEAN_SCALE);
  if (quantized > 0xffff) throw new Error('A state value exceeds the 16-bit range.');
  view.setUint16(index * 2, quantized, true);
  const spread = Math.sqrt(Math.max(0, second[index] - mean[index] ** 2));
  largestSpread = Math.max(largestSpread, spread);
  bytes[YACHT_STATE_COUNT * 2 + index] = Math.min(255, Math.round(spread * YACHT_SPREAD_SCALE));
}
if (largestSpread * YACHT_SPREAD_SCALE > 255) throw new Error('A spread exceeds the 8-bit range.');
writeFileSync(YACHT_TABLE_PATH, bytes);
console.error(`wrote ${YACHT_TABLE_BYTES} bytes to ${YACHT_TABLE_PATH}`);
