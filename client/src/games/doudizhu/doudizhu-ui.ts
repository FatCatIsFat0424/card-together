import { lazy } from 'react';
import { ddzIsBomb } from '@shared/rules/doudizhu';
import { frameLogIndex } from '@shared/game-presentation';
import type { GameUi } from '../game-ui';
import { seatLabel } from '../seat-names';
import { DouDizhuFrame } from './DouDizhuFrame';
import { DouDizhuRounds } from './DouDizhuHistory';
import { DouDizhuRoomOptions } from './DouDizhuRoomOptions';

export const douDizhuUi: GameUi<'doudizhu'> = {
  gameType: 'doudizhu',
  roomOptions: DouDizhuRoomOptions,
  table: lazy(() => import('./DouDizhuTable').then((game) => ({ default: game.DouDizhuTable }))),
  presentation: {
    summary: (game, t) => {
      if (!game.result) return '';
      const { scores, winners } = game.result;
      return t('presentation.doudizhuWinners', {
        scores: winners.map((seat) => `${seatLabel(t, 'doudizhu', seat)} ${scores[seat]}`).join(' · '),
      });
    },
    heading: (frame) => frame.kind === 'deal' ? 'doudizhu.presentationDeal'
      : frame.kind === 'redeal' ? 'doudizhu.presentationRedeal'
        : frame.kind === 'call' ? 'doudizhu.presentationLandlord'
          : frame.kind === 'settle' ? 'doudizhu.presentationSettle' : undefined,
    Frame: DouDizhuFrame,
    playEffect: (game, frame) => {
      const index = frameLogIndex(frame);
      const entry = index === null ? undefined : game.log[index];
      return frame.kind === 'play' && entry?.type === 'play' && ddzIsBomb(entry.combo) ? { kind: 'bomb' } : null;
    },
  },
  roundsView: DouDizhuRounds,
};
