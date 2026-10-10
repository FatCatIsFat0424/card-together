// ─── LiarsDeckTable: Liar's Deck table (table card, face-down pile, hand, calls, info rail, settlement) ───

import { useState } from 'react';
import type { ReactNode } from 'react';
import { ldIsTruth } from '@shared/rules/liarsdeck';
import type { LiarCard, LiarsDeckLogEntry, LiarsDeckMatchResult, LiarsDeckVisibleState } from '@shared/types';
import { socket } from '../../socket';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import { GameShell } from '../GameShell';
import { ResultDialog, resultStyles } from '../ResultDialog';
import { RoundHistory } from '../RoundHistory';
import { infoStyles, RulesBox, TurnBox } from '../TableInfo';
import { useSeatName } from '../seat-names';
import { useConnectionReady } from '../use-connection-ready';
import { useGamePresentation } from '../use-game-presentation';
import { LiarCardFace } from './LiarCardFace';
import { liarsDeckHandMode, liarsDeckView, recentLiarsDeckMoves, toggleSelection } from './liarsdeck-view';
import type { LiarsDeckTableView } from './liarsdeck-view';
import { AppIcon } from '../../components/AppIcon';
import styles from './LiarsDeckTable.module.css';
import { isOwnTurn, isSpectator } from '../observer-view';

const RECENT_MOVES = 8;
const MAX_PILE_BACKS = 6;

type ActionCallback = (timeout: Error | null, response?: { success: boolean; error?: string }) => void;

function Centre({ view }: { view: LiarsDeckTableView }): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const face = view.tableFace;
  return <div className={styles.centre}>
    <div className={styles.piles}>
      {face && <div className={styles.pile}>
        <LiarCardFace face={face} variant={0} className={styles.card} label={t(`liarsdeck.face.${face}`)} />
        <span className={styles.pill}>{t('liarsdeck.tableCard')}</span>
      </div>}
      <div className={styles.pile}>
        <div className={styles.stack} aria-hidden="true">
          {Array.from({ length: Math.min(view.pileCount, MAX_PILE_BACKS) }, (_, index) => (
            <span key={index} className={`${styles.card} ${styles.back}`} />
          ))}
          {view.pileCount === 0 && <span className={`${styles.card} ${styles.empty}`} />}
        </div>
        <span className={styles.pill}>{t('liarsdeck.pile', { n: String(view.pileCount) })}</span>
      </div>
    </div>
    <p className={styles.claim}>
      {view.lastPlay && face ? t('liarsdeck.lastPlay', {
        name: seatName(view.lastPlay.seat), n: String(view.lastPlay.count), face: t(`liarsdeck.face.${face}`),
      }) : t('liarsdeck.noPlay')}
    </p>
    {view.round > 0 && <span className={styles.round}>{t('liarsdeck.round', { n: String(view.round) })}</span>}
  </div>;
}

function MoveLine({ entry }: { entry: LiarsDeckLogEntry }): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  if (entry.type === 'round') {
    return <span className={styles.roundLine}>
      {t('liarsdeck.logRound', { n: String(entry.round), face: t(`liarsdeck.face.${entry.tableFace}`) })}
    </span>;
  }
  return <>
    <span className={infoStyles.name}>{seatName(entry.seat)}</span>
    {entry.type === 'play' && <span>{t('liarsdeck.logPlay', { n: String(entry.count) })}</span>}
    {entry.type === 'challenge' && <>
      <span>{t('liarsdeck.logCall', { name: seatName(entry.target) })}</span>
      <span className={`${styles.tag} ${entry.lied ? styles.tagBad : styles.tagGood}`}>
        {entry.revealed.map((face) => t(`liarsdeck.face.${face}`)).join(' ')} ·
        {' '}{t(entry.lied ? 'liarsdeck.logLied' : 'liarsdeck.logHonest')}
      </span>
    </>}
    {entry.type === 'shot' && <span className={`${styles.tag} ${entry.survived ? '' : styles.tagBad}`}>
      {t(entry.survived ? 'liarsdeck.logSurvived' : 'liarsdeck.logKilled', { n: String(entry.shot) })}
    </span>}
  </>;
}

function Info({ game, view, locked }: { game: LiarsDeckVisibleState; view: LiarsDeckTableView; locked: boolean }): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const recent = recentLiarsDeckMoves(game.log.slice(0, view.logEnd), RECENT_MOVES);
  return <aside className={infoStyles.rail}>
    <TurnBox text={game.phase !== 'playing' || locked ? t('game.playing')
      : isOwnTurn(game) ? t('liarsdeck.yourTurn')
        : t('liarsdeck.turnOf', { name: seatName(game.currentTurnSeat) })}>
      {view.tableFace && <p className={infoStyles.note}>
        {t('liarsdeck.round', { n: String(view.round) })} · {t('liarsdeck.tableCard')}
        {' '}{t(`liarsdeck.face.${view.tableFace}`)}
      </p>}
    </TurnBox>

    <section className={`${infoStyles.box} ${infoStyles.grow}`}>
      <h2 className={infoStyles.caption}>{t('liarsdeck.recent')}</h2>
      {recent.length === 0 ? <p className={infoStyles.note}>{t('liarsdeck.noMoves')}</p>
        : <ol className={infoStyles.list}>{recent.map((entry) => (
          <li key={`${entry.timestamp}-${entry.type}-${'seat' in entry ? entry.seat : entry.round}`} className={infoStyles.row}>
            <MoveLine entry={entry} />
          </li>
        ))}</ol>}
    </section>

    <RulesBox title={t('liarsdeck.rules')} lines={[t('liarsdeck.rulesDeck'), t('liarsdeck.rulesPlay'),
      t('liarsdeck.rulesCall'), t('liarsdeck.rulesGun')]} />
  </aside>;
}

function ResultOverlay({ result, pending, error, disabled, onBack }: {
  result: LiarsDeckMatchResult; pending: boolean; error: string; disabled: boolean; onBack: () => void;
}): ReactNode {
  const { t } = useI18nStore();
  const historyGame = useGameStore((state) => state.visible);
  const seatName = useSeatName();
  // The last player eliminated ranks 2nd, and so on
  const ranking = [result.winnerSeat, ...[...result.eliminationOrder].reverse()];
  return <ResultDialog title={t('liarsdeck.winner', { name: seatName(result.winnerSeat) })}
    pending={pending} error={error} disabled={disabled} onBack={onBack}>
    <table className={`${resultStyles.table} ${styles.rankTable}`}>
      <thead><tr>
        <th>{t('liarsdeck.rank')}</th><th>{t('liarsdeck.player')}</th><th>{t('liarsdeck.pulls')}</th>
      </tr></thead>
      <tbody>{ranking.map((seat, index) => (
        <tr key={seat} className={index === 0 ? resultStyles.winnerRow : ''}>
          <td>{t('liarsdeck.place', { n: String(index + 1) })}</td>
          <td>{index === 0 ? <><AppIcon name="trophy" /> </> : '💀 '}{seatName(seat)}</td>
          <td>{result.shots[seat]} / 6</td>
        </tr>
      ))}</tbody>
    </table>
    <p className={resultStyles.note}>{t('liarsdeck.rounds', { n: String(result.rounds) })}</p>
    {historyGame && <RoundHistory game={historyGame} />}
  </ResultDialog>;
}

function HandCard({ card, variant, selected, truth, disabled, onToggle }: {
  card: LiarCard; variant: number; selected: boolean; truth: boolean; disabled: boolean; onToggle: () => void;
}): ReactNode {
  const { t } = useI18nStore();
  const label = `${t(`liarsdeck.face.${card.face}`)}${truth ? ` · ${t('liarsdeck.matches')}` : ''}`;
  return <button type="button" className={`${styles.handCard} ${selected ? styles.selected : ''} ${truth ? styles.truth : ''}`}
    aria-pressed={selected} aria-label={label} aria-disabled={disabled} title={label}
    onClick={() => { if (!disabled) onToggle(); }}>
    <LiarCardFace face={card.face} variant={variant} className={styles.handFace} label="" />
  </button>;
}

export function LiarsDeckTable(): ReactNode {
  const { locked, frame } = useGamePresentation();
  const connectionReady = useConnectionReady();
  const game = useGameStore((state) => state.liarsDeck);
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const [selected, setSelected] = useState<number[]>([]);
  const [actionError, setActionError] = useState('');
  const [actionPending, setActionPending] = useState(false);

  if (!game) return null;

  const view = liarsDeckView(game, frame);
  const playing = game.phase === 'playing';
  const isMyTurn = playing && !locked && isOwnTurn(game);
  const mode = liarsDeckHandMode(game, isMyTurn);
  const canAct = mode !== 'wait' && connectionReady && !actionPending;
  const chosen = selected.filter((id) => game.myHand.some((card) => card.id === id));
  const watching = isSpectator(game);
  const out = !watching && view.eliminated.includes(game.mySeat);

  const handleActionResult: ActionCallback = (timeout, response) => {
    setActionPending(false);
    if (timeout) setActionError(t('auth.connectionError'));
    else if (!response?.success) setActionError(response?.error ?? t('common.error'));
  };

  const sendPlay = (): void => {
    if (!canAct || mode === 'mustCall' || chosen.length === 0) return;
    setActionError('');
    setActionPending(true);
    setSelected([]);
    socket.timeout(10000).emit('game:liarsdeck:play', { cardIds: chosen }, handleActionResult);
  };

  const sendCall = (): void => {
    if (!canAct || mode === 'play') return;
    setActionError('');
    setActionPending(true);
    setSelected([]);
    socket.timeout(10000).emit('game:liarsdeck:challenge', handleActionResult);
  };

  const backToRoom = (): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:continue', handleActionResult);
  };

  const face = t(`liarsdeck.face.${game.tableFace}`);
  const prompt = !playing ? null
    : view.handHidden ? t('liarsdeck.dealing')
      : watching ? t('liarsdeck.turnOf', { name: seatName(game.currentTurnSeat) })
      : out ? t('liarsdeck.youAreOut')
        : game.myHand.length === 0 ? t('liarsdeck.outOfCards')
          : mode === 'wait' ? t('liarsdeck.turnOf', { name: seatName(game.currentTurnSeat) })
            : mode === 'mustCall' ? t('liarsdeck.mustCall')
              : mode === 'play' && chosen.length === 0 ? t('liarsdeck.firstPlay')
                : t('liarsdeck.pickCards', { face });
  const showHand = playing && !view.handHidden && !out;
  const selectable = showHand && mode !== 'wait' && mode !== 'mustCall' && canAct;

  const handZone = <div className={styles.handArea}>
    {showHand && game.myHand.length > 0 && <div className={styles.hand} role="group" aria-label={t('liarsdeck.hand')}>
      {game.myHand.map((card) => <HandCard key={card.id} card={card} variant={card.id}
        selected={chosen.includes(card.id)} truth={ldIsTruth(card.face, game.tableFace)} disabled={!selectable}
        onToggle={() => setSelected(toggleSelection(chosen, card.id, game.myHand))} />)}
    </div>}
    {view.handHidden && <div className={styles.hand} aria-hidden="true">
      {Array.from({ length: game.myHand.length }, (_, index) => (
        <span key={index} className={`${styles.handCard} ${styles.back}`} />
      ))}
    </div>}
    {showHand && game.myPlayed.length > 0 && <div className={styles.played}>
      <span>{t('liarsdeck.myPlayed')}</span>
      {game.myPlayed.map((card) => <LiarCardFace key={card.id} face={card.face} variant={card.id}
        className={styles.mini} label={t(`liarsdeck.face.${card.face}`)} />)}
    </div>}
    {playing && <div className={styles.controls}>
      {prompt && <span className={`${styles.prompt} ${mode !== 'wait' ? styles.promptActive : ''}`}>{prompt}</span>}
      {showHand && (mode === 'play' || mode === 'playOrCall') && <button type="button"
        className={`btn btn-primary ${styles.ctrl}`} disabled={!canAct || chosen.length === 0}
        onClick={sendPlay}>
        {chosen.length > 0 ? t('liarsdeck.play', { n: String(chosen.length) }) : t('liarsdeck.playNone')}
      </button>}
      {showHand && (mode === 'playOrCall' || mode === 'mustCall') && game.lastPlay && <button type="button"
        className={`btn btn-danger ${styles.ctrl} ${styles.call}`} disabled={!canAct} onClick={sendCall}
        title={t('liarsdeck.callOn', { name: seatName(game.lastPlay.seat) })}>
        {t('liarsdeck.call')}
      </button>}
    </div>}
  </div>;

  return (
    <GameShell
      info={<Info game={game} view={view} locked={locked} />}
      centre={<Centre view={view} />}
      hand={handZone}
      overlay={game.phase === 'scoring' && game.result && <ResultOverlay result={game.result}
        pending={actionPending} error={actionError} disabled={!connectionReady} onBack={backToRoom} />}
      error={game.phase !== 'scoring' ? actionError : undefined}
    />
  );
}
