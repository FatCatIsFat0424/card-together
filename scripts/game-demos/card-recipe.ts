import type { GameSeat } from '../../shared/src/types';
import type { BotAction } from '../../server/src/bots/bot-decisions';
import recipes from './card-recipes.json';

export type CardRecipeGame = keyof typeof recipes;
interface RecipeStep {
  readonly seat: GameSeat;
  readonly draws: number;
  readonly action: BotAction;
}

/** Offline synthetic actions preserve the recorded lesson when live bot policies change. */
export function createCardRecipe(game: CardRecipeGame, random: () => number): {
  readonly next: (seat: GameSeat) => BotAction;
  readonly finish: () => void;
} {
  const steps = recipes[game] as unknown as readonly RecipeStep[];
  let cursor = 0;
  return {
    next: (seat): BotAction => {
      const step = steps[cursor];
      if (!step || step.seat !== seat) throw new Error(`${game}: unexpected tutorial actor at step ${cursor + 1}.`);
      if (!Number.isSafeInteger(step.draws) || step.draws < 0) throw new Error(`${game}: invalid tutorial random count.`);
      // Original decision draws also advanced the deck/trigger stream between actions.
      for (let draw = 0; draw < step.draws; draw++) random();
      cursor++;
      return structuredClone(step.action);
    },
    finish: (): void => {
      if (cursor !== steps.length) throw new Error(`${game}: unused tutorial actions after settlement.`);
    },
  };
}
