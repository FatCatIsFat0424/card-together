// ─── CodeBreakerTable: seats with guess counts, the viewed seat's guess history, and the code entry pad ───

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { CodeBreakerGuess, CodeBreakerMatchResult, CodeBreakerVisibleState, GameSeat } from '@shared/types';
import { CB_MAX_GUESSES, CB_SLOTS, cbRank } from '@shared/rules/codebreaker';
import type { CbCode, CbVariant } from '@shared/rules/codebreaker';
import { socket } from '../../socket';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import { useTablePerspectiveStore } from '../../stores/table-perspective-store';
import { AppIcon } from '../../components/AppIcon';
import { Button } from '../../components/Button';
import { TableSeat } from '../../components/TableSeat';
import { GameShell } from '../GameShell';
import { ResultDialog, resultStyles } from '../ResultDialog';
import type { ResultHistory } from '../ResultDialog';
import { infoStyles, TurnBox } from '../TableInfo';
import { isSpectator } from '../observer-view';
import { useReplayMode } from '../replay-mode';
import { joinNames, useSeatName } from '../seat-names';
import { useConnectionReady } from '../use-connection-ready';
import { useViewedGame } from '../use-table-perspective';
import { CodeRow, CodeToken, FeedbackMark, useCodeLabel, useSymbolLabel } from './CodeBreakerPegs';
import {
  EMPTY_DRAFT, backspace, draftCode, padSymbols, placeSymbol, seatView, seatsStillGuessing, selectSlot, symbolTaken,
  viewedHistory,
} from './codebreaker-view';
import type { CodeDraft } from './codebreaker-view';
import styles from './CodeBreakerTable.module.css';

type ActionCallback = (timeout: Error | null, response?: { success: boolean; error?: string }) => void;

/** Typing into chat or any field must never enter the code. */
function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

function SeatStats({ game, seat }: { game: CodeBreakerVisibleState; seat: GameSeat }): ReactNode {
  const { t } = useI18nStore();
  const view = seatView(game, seat);
  if (!view) return null;
  const used = String(view.used);
  return <>
    {view.solved
      ? <span className={`${styles.chip} ${styles.good}`} title={t('codebreaker.solvedTitle', { n: used })}>
        <AppIcon name="check" />{t('codebreaker.solvedChip', { n: used })}</span>
      : <span className={styles.chip} title={t('codebreaker.usedTitle', { n: used, max: String(CB_MAX_GUESSES) })}>
        {t('codebreaker.usedChip', { n: used, max: String(CB_MAX_GUESSES) })}</span>}
    {game.phase === 'playing' && view.outOfGuesses && <span className={styles.chip}>{t('codebreaker.doneChip')}</span>}
    {game.phase === 'playing' && view.submitted && <span className={`${styles.chip} ${styles.good}`}>
      <AppIcon name="check" />{t('codebreaker.guessedChip')}</span>}
  </>;
}

function HistoryRow({ variant, guess, index }: { variant: CbVariant; guess: CodeBreakerGuess; index: number }): ReactNode {
  const { t } = useI18nStore();
  const codeLabel = useCodeLabel();
  return <li className={styles.entry}>
    <span className={styles.index}>{index + 1}</span>
    <CodeRow variant={variant} code={guess.code}
      label={t('codebreaker.guessLabel', { n: String(index + 1), code: codeLabel(variant, guess.code) })} />
    <FeedbackMark variant={variant} exact={guess.exact} partial={guess.partial} />
    {guess.auto && <span className={styles.auto} title={t('codebreaker.autoTitle')}>{t('codebreaker.auto')}</span>}
  </li>;
}

function SecretRow({ game }: { game: CodeBreakerVisibleState }): ReactNode {
  const { t } = useI18nStore();
  const codeLabel = useCodeLabel();
  const variant = game.options.variant;
  return <div className={styles.secret}>
    <span className={styles.secretLabel}>{t('codebreaker.secret')}</span>
    {game.secret
      ? <CodeRow variant={variant} code={game.secret} label={`${t('codebreaker.secret')}: ${codeLabel(variant, game.secret)}`} />
      : <span className={styles.row} role="img" aria-label={t('codebreaker.hiddenSecret')} title={t('codebreaker.hiddenSecret')}>
        {Array.from({ length: CB_SLOTS }, (_, slot) => <span key={slot} className={styles.hidden}>?</span>)}
      </span>}
  </div>;
}

function History({ game, seat, pending }: { game: CodeBreakerVisibleState; seat: GameSeat; pending: CbCode | null }): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const codeLabel = useCodeLabel();
  const listRef = useRef<HTMLOListElement>(null);
  const variant = game.options.variant;
  const guesses = viewedHistory(game, seat);
  const own = seat === game.mySeat && !isSpectator(game);
  // The newest guess stays in view as the list grows.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [guesses.length, pending]);
  return <section className={styles.history} aria-label={own ? t('codebreaker.yourGuesses') : t('codebreaker.guessesOf', { name: seatName(seat) })}>
    <header className={styles.historyHead}>
      <h2 className={styles.title}>{own ? t('codebreaker.yourGuesses') : t('codebreaker.guessesOf', { name: seatName(seat) })}</h2>
      <span className={styles.round}>{t('codebreaker.round', { n: String(Math.min(game.round, CB_MAX_GUESSES)), max: String(CB_MAX_GUESSES) })}</span>
    </header>
    <SecretRow game={game} />
    {guesses.length === 0 && !pending
      ? <p className={styles.empty}>{t('codebreaker.noGuesses')}</p>
      : <ol className={styles.list} ref={listRef}>
        {guesses.map((guess, index) => <HistoryRow key={guess.round} variant={variant} guess={guess} index={index} />)}
        {pending && <li className={`${styles.entry} ${styles.pendingEntry}`}>
          <span className={styles.index}>{guesses.length + 1}</span>
          <CodeRow variant={variant} code={pending} label={codeLabel(variant, pending)} />
          <span className={styles.pendingText}>{t('codebreaker.pending')}</span>
        </li>}
      </ol>}
    <p className={styles.legend}>{t(variant === 'digits' ? 'codebreaker.legendDigits' : 'codebreaker.legendColors')}</p>
  </section>;
}

function EntryPad({ game, draft, enabled, onDraft, onSubmit, pending, error }: {
  game: CodeBreakerVisibleState; draft: CodeDraft; enabled: boolean; onDraft: (draft: CodeDraft) => void;
  onSubmit: () => void; pending: boolean; error: string;
}): ReactNode {
  const { t } = useI18nStore();
  const symbolLabel = useSymbolLabel();
  const variant = game.options.variant;
  const code = draftCode(draft);
  const filled = draft.slots.some((value) => value !== null);
  return <div className={styles.entryPad}>
    <div className={styles.slots} role="group" aria-label={t('codebreaker.slots')}>
      {draft.slots.map((value, slot) => <button key={slot} type="button" disabled={!enabled}
        className={`${styles.slot} ${slot === draft.cursor && enabled ? styles.cursor : ''}`}
        aria-pressed={slot === draft.cursor}
        aria-label={t('codebreaker.slot', { n: String(slot + 1), value: value === null ? t('codebreaker.slotEmpty') : symbolLabel(variant, value) })}
        onClick={() => onDraft(selectSlot(draft, slot))}>
        {value !== null && <CodeToken variant={variant} symbol={value} />}
      </button>)}
    </div>
    <div className={`${styles.pad} ${variant === 'colors' ? styles.colorPad : ''}`} role="group" aria-label={t('codebreaker.pad')}>
      {padSymbols(variant).map((symbol) => {
        const taken = symbolTaken(draft, symbol, variant);
        return <button key={symbol} type="button" className={styles.key} disabled={!enabled || taken}
          aria-label={taken ? t('codebreaker.digitTaken', { n: String(symbol) }) : symbolLabel(variant, symbol)}
          onClick={() => onDraft(placeSymbol(draft, symbol, variant))}>
          <span className={styles.keyFace}><CodeToken variant={variant} symbol={symbol} /></span>
        </button>;
      })}
    </div>
    <div className={styles.actions}>
      <Button className={styles.action} disabled={!enabled || !filled} onClick={() => onDraft(backspace(draft))}>
        {t('codebreaker.backspace')}</Button>
      <Button className={styles.action} disabled={!enabled || !filled} onClick={() => onDraft(EMPTY_DRAFT)}>
        {t('codebreaker.clear')}</Button>
      <Button variant="primary" className={`${styles.action} ${styles.submit}`} disabled={!enabled || code === null || pending}
        title={code === null ? t('codebreaker.submitHint') : undefined} onClick={onSubmit}>
        {t('codebreaker.submit')}</Button>
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
  </div>;
}

function Info({ game }: { game: CodeBreakerVisibleState }): ReactNode {
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const variant = game.options.variant;
  return <aside className={infoStyles.rail}>
    <TurnBox text={t('codebreaker.round', { n: String(Math.min(game.round, CB_MAX_GUESSES)), max: String(CB_MAX_GUESSES) })}>
      <p className={infoStyles.note}>{t(variant === 'digits' ? 'codebreaker.infoVariantDigits' : 'codebreaker.infoVariantColors')}</p>
      <p className={infoStyles.note}>{t('codebreaker.infoCap', { max: String(CB_MAX_GUESSES) })}</p>
    </TurnBox>
    <section className={`${infoStyles.box} ${infoStyles.grow}`}>
      <h2 className={infoStyles.caption}>{t('codebreaker.players')}</h2>
      <ol className={infoStyles.list}>
        {game.seats.map((seat) => {
          const view = seatView(game, seat);
          return <li key={seat} className={infoStyles.row}>
            <span className={infoStyles.name}>{seatName(seat)}</span>
            {view && <span>{view.solved ? t('codebreaker.solvedChip', { n: String(view.used) })
              : t('codebreaker.usedChip', { n: String(view.used), max: String(CB_MAX_GUESSES) })}</span>}
          </li>;
        })}
      </ol>
      <p className={infoStyles.note}>{t('codebreaker.infoHidden')}</p>
      <p className={infoStyles.note}>{t(variant === 'digits' ? 'codebreaker.legendDigits' : 'codebreaker.legendColors')}</p>
    </section>
  </aside>;
}

function ResultOverlay({ game, result, pending, error, disabled, onBack }: {
  game: CodeBreakerVisibleState; result: CodeBreakerMatchResult; pending: boolean; error: string; disabled: boolean;
  onBack: () => void;
}): ReactNode {
  const { t, locale } = useI18nStore();
  const seatName = useSeatName();
  const codeLabel = useCodeLabel();
  const variant = result.variant;
  const watching = isSpectator(game);
  const mine = !watching && result.seats.includes(game.mySeat);
  const finishes = result.seats.map((seat) => ({ seat, guesses: result.guesses[seat] ?? 0, solved: result.solved.includes(seat) }));
  const ranked = [...finishes].sort((a, b) => cbRank(finishes, a.seat) - cbRank(finishes, b.seat));
  const won = mine && result.winners.includes(game.mySeat);
  const title = result.winners.length === 0 ? t('codebreaker.noWinner')
    : watching || !mine ? t('codebreaker.winnerTitle', { names: joinNames(result.winners.map(seatName), locale) })
      : won ? t('codebreaker.youWon') : t('codebreaker.youLost');
  const tone = result.winners.length === 0 ? 'draw' : won || watching || !mine ? 'win' : 'lose';
  const history: ResultHistory = {
    label: t('codebreaker.allGuesses'),
    content: <div className={styles.allGuesses}>
      {result.seats.map((seat) => <section key={seat} className={styles.guessBlock}>
        <h3 className={styles.guessName}>{seatName(seat)}</h3>
        <ol className={styles.list}>
          {(game.histories[seat] ?? []).map((guess, index) => <HistoryRow key={guess.round} variant={variant} guess={guess} index={index} />)}
        </ol>
      </section>)}
    </div>,
  };
  return <ResultDialog title={title} tone={tone} pending={pending} error={error} disabled={disabled} onBack={onBack} history={history}>
    <div className={styles.resultSecret}>
      <span className={styles.secretLabel}>{t('codebreaker.secret')}</span>
      <CodeRow variant={variant} code={result.secret} label={`${t('codebreaker.secret')}: ${codeLabel(variant, result.secret)}`} />
    </div>
    <table className={resultStyles.table}>
      <thead><tr>
        <th>{t('codebreaker.rank')}</th><th>{t('codebreaker.player')}</th><th>{t('codebreaker.guesses')}</th>
      </tr></thead>
      <tbody>{ranked.map((finish) => (
        <tr key={finish.seat} className={result.winners.includes(finish.seat) ? resultStyles.winnerRow : ''}>
          <td>{t('codebreaker.place', { n: String(cbRank(finishes, finish.seat)) })}</td>
          <td>{result.winners.includes(finish.seat) ? <><AppIcon name="trophy" /> </> : ''}{seatName(finish.seat)}</td>
          <td>{finish.solved ? finish.guesses : t('codebreaker.notCracked')}</td>
        </tr>
      ))}</tbody>
    </table>
    <p className={resultStyles.note}>{t('codebreaker.rounds', { n: String(result.rounds) })}</p>
  </ResultDialog>;
}

export function CodeBreakerTable(): ReactNode {
  const connectionReady = useConnectionReady();
  const game = useViewedGame(useGameStore((state) => state.codebreaker));
  const { t } = useI18nStore();
  const seatName = useSeatName();
  const replay = useReplayMode();
  const selectSeat = useTablePerspectiveStore((state) => state.selectSeat);
  const [draftState, setDraftState] = useState<{ round: number; draft: CodeDraft }>({ round: 0, draft: EMPTY_DRAFT });
  const [actionError, setActionError] = useState('');
  const [actionPending, setActionPending] = useState(false);

  const watching = isSpectator(game);
  const own = game ? seatView(game, game.mySeat) : null;
  const owes = !watching && replay === null && own !== null && own.owes;
  const canAct = owes && connectionReady && !actionPending;
  // A new round starts with an empty entry, so a stale pick never carries over.
  const draft = game && draftState.round === game.round ? draftState.draft : EMPTY_DRAFT;
  const round = game?.round ?? 0;
  const variant = game?.options.variant;
  const setDraft = useCallback((next: CodeDraft): void => setDraftState({ round, draft: next }), [round]);

  const handleResult: ActionCallback = (timeout, response) => {
    setActionPending(false);
    if (timeout) setActionError(t('auth.connectionError'));
    else if (!response?.success) setActionError(response?.error ?? t('common.error'));
    else setDraft(EMPTY_DRAFT);
  };

  const submit = (): void => {
    const code = draftCode(draft);
    if (!canAct || code === null) return;
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:action', { gameType: 'codebreaker', action: { type: 'guess', code: [...code] } }, handleResult);
  };

  const backToRoom = (): void => {
    setActionError('');
    setActionPending(true);
    socket.timeout(10000).emit('game:continue', (timeout, response) => {
      setActionPending(false);
      if (timeout) setActionError(t('auth.connectionError'));
      else if (!response?.success) setActionError(response?.error ?? t('common.error'));
    });
  };

  // Desktop keyboards: digits (or 1–6 for colours) fill the code, Backspace deletes, Enter submits.
  useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      if (!canAct || !variant || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) return;
      if (event.key === 'Backspace') {
        event.preventDefault();
        setDraft(backspace(draft));
      } else if (event.key === 'Enter') {
        if (draftCode(draft) !== null && !(event.target instanceof HTMLButtonElement)) {
          event.preventDefault();
          submit();
        }
      } else if (/^[0-9]$/.test(event.key)) {
        const symbol = variant === 'digits' ? Number(event.key) : Number(event.key) - 1;
        if (symbol >= 0 && symbol < padSymbols(variant).length) {
          event.preventDefault();
          setDraft(placeSymbol(draft, symbol, variant));
        }
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  });

  if (!game) return null;

  const waiting = seatsStillGuessing(game);
  const status = game.phase === 'scoring' ? ''
    : watching ? t('codebreaker.spectating', { name: seatName(game.mySeat) })
      : own?.solved ? t('codebreaker.cracked', { n: String(own.used) })
        : own?.outOfGuesses ? t('codebreaker.outOfGuesses', { max: String(CB_MAX_GUESSES) })
          : own?.submitted ? `${t('codebreaker.locked')} ${waiting > 0 ? t('codebreaker.waiting', { n: String(waiting) }) : ''}`
            : owes ? t('codebreaker.yourTurn') : '';
  const viewSeat = game.mySeat;

  const table = <div className={styles.table} data-code-breaker-table data-expanded-table="">
    <div className={styles.seats}>
      {game.seats.filter((seat) => seat !== viewSeat).map((seat) => <TableSeat key={seat} seat={seat} position="top"
        stats={<SeatStats game={game} seat={seat} />}
        onObserve={watching ? () => selectSeat(seat) : undefined} />)}
    </div>
    <History game={game} seat={viewSeat} pending={watching ? null : game.pendingGuess} />
    <section className={`${styles.input} ${owes ? styles.owes : ''}`} aria-label={t('codebreaker.slots')}>
      {game.seats.includes(viewSeat) && <div className={styles.ownSeat}>
        <TableSeat seat={viewSeat} position="bottom" stats={<SeatStats game={game} seat={viewSeat} />}
          onObserve={watching ? () => selectSeat(viewSeat) : undefined} />
      </div>}
      {status && <p className={styles.status} role="status">{status}</p>}
      {!watching && game.phase === 'playing' && <EntryPad game={game} draft={draft} enabled={canAct}
        onDraft={setDraft} onSubmit={submit} pending={actionPending} error={actionError} />}
    </section>
  </div>;

  return (
    <GameShell
      info={<Info game={game} />}
      centre={null}
      hand={null}
      turnReady={owes && connectionReady}
      board={table}
      overlay={game.phase === 'scoring' && game.result && <ResultOverlay game={game} result={game.result}
        pending={actionPending} error={actionError} disabled={!connectionReady} onBack={backToRoom} />}
    />
  );
}
