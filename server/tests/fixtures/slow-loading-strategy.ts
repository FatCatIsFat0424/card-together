// Test-only search strategy whose module takes longer to load than the pool's grace, like a cold
// transpile of a large search module.
import type { BotAction } from '../../src/bots/bot-decisions';

await new Promise((resolve) => setTimeout(resolve, 600));

export function slowLoadingSearch(): BotAction {
  return { type: 'liarsdeck-play', cardIds: [] };
}
