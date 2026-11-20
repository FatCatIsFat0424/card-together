import type { StudAction, StudVisibleState } from '@shared/types';
import type { BotAction } from './bot-decisions';
import { evaluateCandidates, studCandidates, studLegal } from './stud-sim';
import type { StudLimits } from './stud-sim';

// Expected-value play for five-card stud, described with the simulation in stud-sim.ts. The synchronous decision
// samples a few hundred hands within a few tens of milliseconds; the worker pool's search (stud-search.ts) uses
// the same evaluation with a time budget and stops early once one action clearly leads.

/** Samples and time of the synchronous decision, used when no worker pool runs or a search fails. */
const SYNC_LIMITS = { minWorlds: 60, maxWorlds: 160, milliseconds: 30 };

function action(request: StudAction): BotAction {
  return { type: 'game-action', request: { gameType: 'stud', action: request } };
}

/** The best action by expected value, or null when it is not the seat's turn. */
export function studDecision(visible: StudVisibleState, random: () => number, limits: StudLimits): StudAction | null {
  const legal = studLegal(visible);
  if (!legal) return null;
  const candidates = studCandidates(visible, legal);
  if (candidates.length === 1) return candidates[0].action;
  const evaluation = evaluateCandidates(visible, candidates, random, limits);
  if (!evaluation) return legal.check ? { type: 'check' } : { type: 'fold' };
  let best = 0;
  // The first candidate (check, or fold) wins ties, then the call.
  for (let index = 1; index < candidates.length; index++) {
    if (evaluation.values[index] > evaluation.values[best] + 1e-9) best = index;
  }
  return candidates[best].action;
}

export function getStudBotAction(visible: StudVisibleState, random: () => number): BotAction | null {
  const deadline = performance.now() + SYNC_LIMITS.milliseconds;
  const request = studDecision(visible, random, {
    minWorlds: SYNC_LIMITS.minWorlds, maxWorlds: SYNC_LIMITS.maxWorlds, timeLeftMs: () => deadline - performance.now(),
  });
  return request ? action(request) : null;
}
