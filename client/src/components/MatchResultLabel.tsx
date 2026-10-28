import type { ReactNode } from 'react';
import type { GameSeat, MatchSummary, PublicAccount } from '@shared/types';
import { resultSeats } from '../game-view';
import { clientGame } from '../games/registry';
import { joinNames, seatLabel } from '../games/seat-names';
import { useI18nStore } from '../stores/i18n-store';
import { AppIcon } from './AppIcon';

/** One-line summary of a finished match from the viewpoint of `accountId`. */
export function MatchResultLabel({ match, players, accountId }: {
  readonly match: MatchSummary; readonly players: Readonly<Record<string, PublicAccount>>; readonly accountId?: string;
}): ReactNode {
  const { locale, t } = useI18nStore();
  const { result } = match;
  // accountIds follow the recorded seats in N, E, S, W order
  const seats = resultSeats(result);
  const mySeat = seats[match.accountIds.indexOf(accountId ?? '')];
  const seatName = (seat: GameSeat): string => {
    const id = match.accountIds[seats.indexOf(seat)];
    const label = seatLabel(t, result.gameType, seat);
    return id?.startsWith('bot:') ? t('player.botSeat', { seat: label }) : players[id]?.nickname ?? label;
  };
  const summary = clientGame(result.gameType).result.summary(result, mySeat, t);
  if (summary.kind === 'text') return <span>{summary.text}</span>;
  return <span><AppIcon name="trophy" /> {joinNames(summary.winners.map(seatName), locale)}{summary.suffix}
    {summary.detail && <> · {t(summary.detail.key, { n: summary.detail.n })}</>}</span>;
}
