import type { ReactNode } from 'react';
import type { MatchHistory, MatchSummary, PublicAccount, Seat } from '@shared/types';
import { SEAT_ORDER_CLOCKWISE, SUIT_SYMBOLS } from '@shared/constants';
import { useAccountStore } from '../stores/account-store';
import { useI18nStore } from '../stores/i18n-store';
import { joinNames } from '../games/seat-names';
import { PlayerLink } from './PlayerLink';
import styles from './MatchHistoryList.module.css';

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function MatchResultLabel({ match, players }: {
  match: MatchSummary; players: Record<string, PublicAccount>;
}): ReactNode {
  const { locale, t } = useI18nStore();
  const myId = useAccountStore((state) => state.account?.id);
  const { result } = match;
  // accountIds are ordered by seat N, E, S, W
  const mySeat = SEAT_ORDER_CLOCKWISE[match.accountIds.indexOf(myId ?? '')];
  const seatName = (seat: Seat): string => {
    const id = match.accountIds[SEAT_ORDER_CLOCKWISE.indexOf(seat)];
    return id?.startsWith('bot:') ? t('player.botSeat', { seat: t(`seat.${seat}`) })
      : players[id]?.nickname ?? t(`seat.${seat}`);
  };
  if (result.gameType === 'redpoints') {
    return <span>{t('gameType.redpoints')} · 🏆 {joinNames(result.winners.map(seatName), locale)}
      {mySeat && <> · {t('redpoints.myPoints', { n: String(result.points[mySeat]) })}</>}</span>;
  }
  if (result.gameType === 'sevens') {
    return <span>{t('gameType.sevens')} · 🏆 {joinNames(result.winners.map(seatName), locale)}
      {mySeat && <> · {t('sevens.myPenalty', { n: String(result.penalties[mySeat]) })}</>}</span>;
  }
  if (result.gameType === 'chinesepoker') {
    return <span>{t('gameType.chinesepoker')} · 🏆 {joinNames(result.winners.map(seatName), locale)}
      {mySeat && <> · {t('chinesepoker.myScore', { n: signed(result.scores[mySeat]) })}</>}</span>;
  }
  if (result.gameType === 'blackjack') {
    return <span>{t('gameType.blackjack')} · 🏆 {joinNames(result.winners.map(seatName), locale)}
      {mySeat && <> · {t('blackjack.myChips', { n: String(result.chips[mySeat]) })}</>}</span>;
  }
  if (result.gameType === 'ninetynine') {
    // Players eliminated earlier rank lower
    const myRank = mySeat && (mySeat === result.winnerSeat ? 1 : 4 - result.eliminationOrder.indexOf(mySeat));
    return <span>{t('gameType.ninetynine')} · 🏆 {seatName(result.winnerSeat)}
      {myRank && <> · {t('ninetynine.myRank', { n: String(myRank) })}</>}</span>;
  }
  if (result.gameType === 'liarsdeck') {
    const myRank = mySeat && (mySeat === result.winnerSeat ? 1 : 4 - result.eliminationOrder.indexOf(mySeat));
    return <span>{t('gameType.liarsdeck')} · 🏆 {seatName(result.winnerSeat)}
      {myRank && <> · {t('liarsdeck.myRank', { n: String(myRank) })}</>}</span>;
  }
  if (result.gameType === 'bigtwo') {
    return <span>{t('gameType.bigtwo')} · 🏆 {seatName(result.winnerSeat)}
      {result.dragon && ' 🐉'}
      {mySeat && <> · {t('bigtwo.myPenalty', { n: String(result.scores[mySeat]) })}</>}</span>;
  }
  return <span>{t('gameType.bridge')} · {result.contract.level}{result.contract.suit === 'nt' ? 'NT'
    : SUIT_SYMBOLS[result.contract.suit]} · {result.declarerTeamTricks}
    /{result.requiredTricks} · {t(result.declarerTeamWins
      ? 'score.declarerWins' : 'score.defenderWins')}</span>;
}

export function MatchHistoryList({ matches, players }: MatchHistory): ReactNode {
  const { t, locale } = useI18nStore();
  if (matches.length === 0) return <p className={styles.empty}>{t('history.empty')}</p>;
  return <ul className={styles.list}>{matches.map((match) => (
    <li key={match.id} className={styles.match}>
      <div className={styles.summary}>
        <span>{t('room.title')} {match.roomCode}</span>
        <MatchResultLabel match={match} players={players} />
        <time dateTime={new Date(match.finishedAt).toISOString()} className={styles.time}>
          {new Date(match.finishedAt).toLocaleString(locale)}
        </time>
      </div>
      <div className={styles.players}>
        {match.accountIds.map((id, index) => id.startsWith('bot:')
          ? <span key={id} className={styles.bot}>{t('player.botSeat', { seat: t(`seat.${SEAT_ORDER_CLOCKWISE[index]}`) })}</span>
          : players[id] && <PlayerLink key={id} player={players[id]} />)}
      </div>
    </li>
  ))}</ul>;
}
