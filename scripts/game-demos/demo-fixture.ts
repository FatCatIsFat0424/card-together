import { applyReplayPatch, diffReplaySnapshot } from '../../shared/src/replay-patch';
import type { GameSeat, PlayerVisibleGameState } from '../../shared/src/types';
import type { DemoFixture, DemoStep } from './demo-fixture-types';

export interface ExpandedDemoStep extends Omit<DemoStep, 'patch'> {
  readonly after: PlayerVisibleGameState;
}

export interface ExpandedDemoFixture extends Omit<DemoFixture, 'steps'> {
  readonly steps: readonly ExpandedDemoStep[];
}

export function expandDemoFixture(fixture: DemoFixture): ExpandedDemoFixture {
  let current = fixture.initial;
  const steps = fixture.steps.map(({ patch, ...step }) => {
    current = applyReplayPatch(current, patch);
    return { ...step, after: current };
  });
  return { ...fixture, steps };
}

/** Preserve the first four teaching deals while upgrading their storage format. */
export function compactLegacyFixture(fixture: {
  readonly code: string;
  readonly focusSeat: GameSeat;
  readonly seats: readonly GameSeat[];
  readonly initial: PlayerVisibleGameState;
  readonly steps: readonly ExpandedDemoStep[];
  readonly result: NonNullable<PlayerVisibleGameState['result']>;
}): DemoFixture {
  let previous = fixture.initial;
  const steps = fixture.steps.map(({ after, ...step }) => {
    const patch = diffReplaySnapshot(previous, after);
    previous = after;
    return { ...step, patch };
  });
  return { ...fixture, steps };
}
