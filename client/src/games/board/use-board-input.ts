import { useCallback, useState } from 'react';
import type { NodeId } from '@shared/rules/board/board-model';
import type { CardInput } from '../../components/card-hand-touch';
import { useBoardInputStore } from '../../stores/board-input-store';
import { IDLE_BOARD_INPUT, confirmBoardInput, confirmsMove, tapBoard, validBoardInput } from './board-input';
import type { BoardChoice, BoardInputRules, BoardInputState, BoardTapResult } from './board-input';

export interface BoardInput {
  readonly selected: NodeId | null;
  readonly pending: BoardChoice | null;
  /** Pass to `BoardView.onNodeClick`. */
  readonly tap: (node: NodeId | null, input: CardInput) => void;
  readonly confirm: () => void;
  readonly cancel: () => void;
}

/**
 * Selection and confirmation for one board table. `active` is false while the player cannot move (not their
 * turn, a presentation, auto-play), which clears any choice; `onMove` receives each confirmed move.
 */
export function useBoardInput(rules: BoardInputRules, active: boolean, onMove: (choice: BoardChoice) => void): BoardInput {
  const oneTap = useBoardInputStore((state) => state.oneTap);
  const [raw, setRaw] = useState<BoardInputState>(IDLE_BOARD_INPUT);
  // Legality comes from the latest snapshot, so a stale choice disappears without an effect.
  const state = validBoardInput(raw, rules, active);
  const apply = useCallback((result: BoardTapResult): void => {
    setRaw(result.state);
    if (result.submit) onMove(result.submit);
  }, [onMove]);
  return {
    selected: state.selected,
    pending: state.pending,
    tap: (node, input) => {
      if (active) apply(tapBoard(state, node, rules, confirmsMove(input, oneTap)));
    },
    confirm: () => {
      if (active && state.pending) apply(confirmBoardInput(state));
    },
    cancel: () => setRaw(IDLE_BOARD_INPUT),
  };
}
