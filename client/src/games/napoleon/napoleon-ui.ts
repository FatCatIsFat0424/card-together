import { lazy } from 'react';
import { frameLogIndex } from '@shared/game-presentation';
import { isNapoleonFinalTrick, isNapoleonJoker, sameNapoleonCard } from '@shared/rules/napoleon';
import type { GameUi } from '../game-ui';
import { NapoleonRoomOptions } from './NapoleonRoomOptions';
import { NapoleonChip } from './NapoleonChip';
import { NapoleonFrame } from './NapoleonFrame';

export const napoleonUi: GameUi<'napoleon'> = {
  gameType: 'napoleon',
  roomOptions: NapoleonRoomOptions,
  table: lazy(() => import('./NapoleonTable').then((game) => ({ default: game.NapoleonTable }))),
  centre: { wide: true },
  hudChip: NapoleonChip,
  presentation: {
    summary: (game, t) => {
      // Side totals stay hidden until settlement so they never point at the secretary.
      if (!game.result) return '';
      return `${t(game.result.napoleonWins ? 'napoleon.napoleonWins' : 'napoleon.defendersWin')} · ${t('presentation.napoleonResult', {
        napoleon: t('napoleon.napoleonSide'), n: String(game.result.napoleonPoints),
        defenders: t('napoleon.defenders'), m: String(game.result.defenderPoints),
      })}`;
    },
    style: { large: true, bigCard: true, wideTrick: true },
    heading: (frame) => frame.kind === 'call' ? 'napoleon.presentation.call' : undefined,
    Frame: NapoleonFrame,
    playEffect: (game, frame) => {
      if (frame.kind !== 'play') return null;
      const played = frame.napoleonCards?.[0];
      const index = frameLogIndex(frame);
      if (!played || index === null || index < 0 || index >= game.log.length) return null;
      if (game.secretaryCard && sameNapoleonCard(played, game.secretaryCard)) return { kind: 'secretary' };
      if (isNapoleonJoker(played)) {
        // The committed trick list can already include the trick this frame is still showing.
        const trickIndex = game.log.slice(0, index).filter((entry) => entry.type === 'trick_end').length;
        if (isNapoleonFinalTrick(trickIndex, game.seats.length)) return null;
        return { kind: played.joker === 'big' ? 'bigJoker' : 'smallJoker' };
      }
      return null;
    },
  },
};
