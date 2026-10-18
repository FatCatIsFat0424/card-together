// ─── HistoryRounds: shared round history layout, newest round first and open ───

import { useState } from 'react';
import type { ReactNode } from 'react';
import { RANK_DISPLAY, SUIT_SYMBOLS } from '@shared/constants';
import type { Card } from '@shared/types';
import { AppIcon } from '../components/AppIcon';
import { useI18nStore } from '../stores/i18n-store';
import { ChipIcon } from './ChipIcon';
import type { HistoryRound } from './round-history';
import styles from './HistoryRounds.module.css';

export type HistoryTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

const TONE_CLASS: Record<HistoryTone, string> = {
  neutral: '', primary: styles.primary, success: styles.success, warning: styles.warning, danger: styles.danger,
};

const TEXT_TONE_CLASS: Record<HistoryTone, string> = {
  neutral: styles.muted, primary: styles.accent, success: styles.positive, warning: styles.caution, danger: styles.negative,
};

function classes(...names: readonly (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

export function CardChip({ card, off, title }: { card: Card; off?: boolean; title?: string }): ReactNode {
  const red = card.suit === 'hearts' || card.suit === 'diamonds';
  return <span className={classes(styles.card, red && styles.red, off && styles.off)} title={title}>
    {SUIT_SYMBOLS[card.suit]}{RANK_DISPLAY[card.rank]}</span>;
}

export function CardChips({ cards }: { cards: readonly Card[] }): ReactNode {
  return <span className={styles.cards}>
    {cards.map((card, index) => <CardChip key={`${card.suit}-${card.rank}-${index}`} card={card} />)}</span>;
}

/** A chip for a card shown by name rather than suit and rank, such as a Liar's Deck face. */
export function TextChip({ children, red, off }: { children: ReactNode; red?: boolean; off?: boolean }): ReactNode {
  return <span className={classes(styles.card, red && styles.red, off && styles.off)}>{children}</span>;
}

export function ChipRow({ children }: { children: ReactNode }): ReactNode {
  return <span className={styles.cards}>{children}</span>;
}

/** Face-down cards; the surrounding row names how many. */
export function CardBacks({ count, label }: { count: number; label: string }): ReactNode {
  return <span className={styles.cards} role="img" aria-label={label} title={label}>
    {Array.from({ length: count }, (_, index) => <span key={index} className={`${styles.card} ${styles.back}`} />)}
  </span>;
}

export function ChipAmount({ amount }: { amount: number | string }): ReactNode {
  return <span className={styles.amount}><ChipIcon />{amount}</span>;
}

export function HistoryTag({ tone = 'neutral', title, children }: {
  tone?: HistoryTone; title?: string; children: ReactNode;
}): ReactNode {
  return <span className={classes(styles.tag, TONE_CLASS[tone])} title={title}>{children}</span>;
}

/** The round header's subject, such as the player whose turn the round is. */
export function HistorySubject({ mine, children }: { mine?: boolean; children: ReactNode }): ReactNode {
  return <span className={classes(styles.subject, styles.ellipsis, mine && styles.mine)}>{children}</span>;
}

/** The round's outcome, aligned to the header's end. */
export function HistoryResult({ tone = 'success', trophy, title, children }: {
  tone?: HistoryTone; trophy?: boolean; title?: string; children: ReactNode;
}): ReactNode {
  return <span className={classes(styles.result, TEXT_TONE_CLASS[tone])} title={title}>
    {trophy && <AppIcon name="trophy" />}<span className={styles.ellipsis}>{children}</span>
  </span>;
}

export function HistoryOngoing(): ReactNode {
  const { t } = useI18nStore();
  return <span className={classes(styles.result, styles.tag, styles.primary)}>{t('history.ongoing')}</span>;
}

export function HistoryTrophy({ title }: { title: string }): ReactNode {
  return <span className={styles.trophy} title={title}><AppIcon name="trophy" /></span>;
}

/** Signed chip or point change coloured by direction. */
export function SignedValue({ value, text }: { value: number; text: string }): ReactNode {
  return <span className={classes(styles.amount, value > 0 ? styles.positive : value < 0 ? styles.negative : styles.muted)}>
    {text}</span>;
}

export function HistoryNote({ muted, children }: { muted?: boolean; children: ReactNode }): ReactNode {
  return <span className={classes(styles.note, muted && styles.muted)}>{children}</span>;
}

export function HistoryActions({ numbered, children }: { numbered?: boolean; children: ReactNode }): ReactNode {
  return <ol className={classes(styles.actions, numbered && styles.numbered)}>{children}</ol>;
}

export type HistoryRowState = 'won' | 'lost' | 'muted';

/** One aligned row: who or what acted, what happened, and end marks. */
export function HistoryAction({ index, name, nameTitle, label, mine, state, marks, children }: {
  /** Leading round number, shown only in numbered lists */
  index?: number | null;
  name: ReactNode;
  nameTitle?: string;
  /** Show the leading cell as a quiet action label rather than a player name */
  label?: boolean;
  mine?: boolean;
  state?: HistoryRowState;
  marks?: ReactNode;
  children?: ReactNode;
}): ReactNode {
  return <li className={classes(styles.action, mine && styles.mine, state && styles[state])}>
    {index !== undefined && <span className={styles.index}>{index ?? ''}</span>}
    <span className={classes(label ? styles.label : styles.name, styles.ellipsis)} title={nameTitle}>{name}</span>
    <span className={styles.content}>{children}</span>
    <span className={styles.marks}>{marks}</span>
  </li>;
}

/** A full-width row between actions, such as a Hold'em street. */
export function HistoryDivider({ children }: { children: ReactNode }): ReactNode {
  return <li className={styles.divider}>{children}</li>;
}

/** A flat list without per-round sections, for games whose rounds are a single play. */
export function HistoryPanel({ children }: { children: ReactNode }): ReactNode {
  return <div className={styles.panel}>{children}</div>;
}

function Round({ round, latest, summary, children }: {
  round: HistoryRound; latest: boolean;
  summary: (round: HistoryRound) => ReactNode;
  children: (round: HistoryRound) => ReactNode;
}): ReactNode {
  const { t } = useI18nStore();
  // The latest round stays open as play moves on until the viewer toggles it themselves.
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? latest;
  return <details className={styles.round} open={open} onToggle={(event) => {
    if (event.currentTarget.open !== open) setToggled(event.currentTarget.open);
  }}>
    <summary className={styles.summary}>
      <strong className={styles.number}>{t('history.roundNumber', { n: String(round.number) })}</strong>
      {summary(round)}
    </summary>
    {open && children(round)}
  </details>;
}

export function HistoryRounds({ rounds, summary, children }: {
  rounds: readonly HistoryRound[];
  /** Header content after the round number: tags, then a result or the ongoing mark */
  summary: (round: HistoryRound) => ReactNode;
  /** The round's rows, rendered only while it is open */
  children: (round: HistoryRound) => ReactNode;
}): ReactNode {
  const latest = rounds.at(-1)?.number;
  return <ol className={styles.rounds}>
    {[...rounds].reverse().map((round) => <li key={round.number}>
      <Round round={round} latest={round.number === latest} summary={summary}>{children}</Round>
    </li>)}
  </ol>;
}
