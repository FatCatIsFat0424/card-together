// ─── BridgeTable: Bridge table (bidding, play, redeal confirmation, settlement) ───

import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Card, Seat } from '@shared/types';
import { socket } from '../../socket';
import { useGameStore } from '../../stores/game-store';
import { useRoomStore } from '../../stores/room-store';
import { useI18nStore } from '../../stores/i18n-store';
import { BidLabel } from '../../components/AuctionTable';
import { CardHand } from '../../components/CardHand';
import { BiddingPanel, BiddingWaiting } from '../../components/BiddingPanel';
import { GameInfoRail } from '../../components/GameInfoRail';
import { TrickArea } from '../../components/TrickArea';
import { GameShell } from '../GameShell';
import { ResultDialog } from '../ResultDialog';
import { useConnectionReady } from '../use-connection-ready';
import { useGamePresentation } from '../use-game-presentation';
import styles from './BridgeTable.module.css';
import { useTrickPresentation } from './use-trick-presentation';
import { TrickHistory } from './TrickHistory';

export function BridgeTable(): ReactNode {
  const mySeat = useRoomStore((state) => state.mySeat);
  const { t } = useI18nStore();
  const connectionReady = useConnectionReady();
  const [actionError, setActionError] = useState('');
  const [actionPending, setActionPending] = useState(false);
  const { phase, myHand, currentTurnSeat, validCards, playing, result, redealPendingSeat } =
    useGameStore(
      useShallow((state) => ({
        phase: state.phase,
        myHand: state.myHand,
        currentTurnSeat: state.currentTurnSeat,
        validCards: state.validCards,
        playing: state.playing,
        result: state.result,
        redealPendingSeat: state.redealPendingSeat,
      })),
    );

  const { locked } = useGamePresentation();
  const legacyTrick = useTrickPresentation();
  const hasPresentation = useGameStore((state) => Boolean(state.visible?.presentation));
  const heldTrick = hasPresentation ? null : legacyTrick;
  const isMyTurn = mySeat === currentTurnSeat && !heldTrick && !locked;
  const bottomSeat: Seat = mySeat ?? 'S';

  const seatLabel = (seat: Seat): string => t(`seat.${seat}`);

  const handleActionResult = useCallback(
    (timeout: Error | null, response?: { success: boolean; error?: string }): void => {
      setActionPending(false);
      if (timeout) setActionError(t('auth.connectionError'));
      else if (!response?.success) setActionError(response?.error ?? t('common.error'));
    },
    [t],
  );

  const handlePlayCard = useCallback(
    (card: Card): void => {
      setActionError('');
      setActionPending(true);
      socket.timeout(10000).emit('game:playCard', { card }, handleActionResult);
    },
    [handleActionResult],
  );

  const handleRedealResponse = useCallback(
    (accept: boolean): void => {
      setActionError('');
      setActionPending(true);
      socket.timeout(10000).emit('game:redealResponse', { accept }, handleActionResult);
    },
    [handleActionResult],
  );

  const handleBackToRoom = useCallback((): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:continue', handleActionResult);
  }, [handleActionResult]);

  let centre: ReactNode;
  if (heldTrick) {
    centre = (
      <div className={styles.completedTrick}>
        <TrickArea
          currentTrick={heldTrick.trick.cards}
          leadSeat={heldTrick.trick.leadSeat}
          bottomSeat={bottomSeat}
          myTurn={false}
        />
        <p className={styles.trickResult} role="status">
          {t('table.trickNumber', { n: String(heldTrick.number) })} ·{' '}
          {t('table.trickWinner', { seat: seatLabel(heldTrick.trick.winnerSeat) })}
        </p>
      </div>
    );
  } else if (phase === 'playing' && playing) {
    centre = (
      <TrickArea
        currentTrick={playing.currentTrick}
        leadSeat={playing.trickLeadSeat}
        bottomSeat={bottomSeat}
        myTurn={isMyTurn}
      />
    );
  } else if (phase === 'bidding') {
    centre = mySeat === currentTurnSeat ? null : <BiddingWaiting seat={currentTurnSeat} />;
  } else if (phase === 'redeal_pending' && redealPendingSeat === mySeat) {
    centre = (
      <div className={styles.overlayCard}>
        <h2 className={styles.overlayTitle}>{t('redeal.title')}</h2>
        <p className={styles.overlayText}>{t('redeal.description')}</p>
        <div className={styles.overlayActions}>
          <button
            className="btn btn-success"
            disabled={actionPending || !connectionReady}
            onClick={() => handleRedealResponse(true)}
          >
            {t('redeal.accept')}
          </button>
          <button
            className="btn btn-outline"
            disabled={actionPending || !connectionReady}
            onClick={() => handleRedealResponse(false)}
          >
            {t('redeal.decline')}
          </button>
        </div>
      </div>
    );
  } else if (phase === 'redeal_pending') {
    centre = <p className={styles.centreText}>{t('game.redealPending')}</p>;
  } else if (phase !== 'scoring') {
    centre = <p className={styles.centreText}>{t('common.loading')}</p>;
  }

  const overlay = phase === 'scoring' && result && !heldTrick && (
    <ResultDialog tone={result.declarerTeamWins ? 'win' : 'lose'}
      title={result.declarerTeamWins ? t('score.declarerWins') : t('score.defenderWins')}
      pending={actionPending} error={actionError} disabled={!connectionReady} onBack={handleBackToRoom}>
      <dl className={styles.scoreDetails}>
        <dt>{t('game.contract')}</dt>
        <dd>
          <BidLabel level={result.contract.level} suit={result.contract.suit} />{' '}
          {t('score.declarerSeat', { seat: seatLabel(result.contract.declarer) })}
        </dd>
        <dt>{t('score.required')}</dt><dd>{result.requiredTricks}</dd>
        <dt>{t('score.declarerTricks')}</dt><dd>{result.declarerTeamTricks}</dd>
        <dt>{t('score.defenderTricks')}</dt><dd>{result.defenderTeamTricks}</dd>
      </dl>
      <TrickHistory tricks={playing?.completedTricks ?? []} />
    </ResultDialog>
  );

  return (
    <GameShell
      turnReady={isMyTurn}
      info={<GameInfoRail />}
      centre={centre}
      hand={
        <CardHand
          cards={myHand}
          playableCards={isMyTurn ? validCards : []}
          onCardClick={handlePlayCard}
          disabled={actionPending || !connectionReady || !isMyTurn || phase !== 'playing'}
        />
      }
      overlay={overlay}
      panel={phase === 'bidding' && mySeat !== null && mySeat === currentTurnSeat
        ? <BiddingPanel disabled={!connectionReady} /> : undefined}
      error={phase !== 'scoring' ? actionError : undefined}
    />
  );
}
