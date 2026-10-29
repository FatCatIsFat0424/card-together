// ─── Resign, draw offers, and move confirmation beside the player's own seat ───

import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import Dialog from '@mui/material/Dialog';
import useMediaQuery from '@mui/material/useMediaQuery';
import type { GameSeat } from '@shared/types';
import { canAnswerDraw, drawOfferBlock } from '@shared/rules/board/match-controls';
import type {
  DrawOfferBlock, DrawOfferState, MatchControlAction, MatchControlContext, MatchControlRules,
} from '@shared/rules/board/match-controls';
import { Button } from '../../components/Button';
import type { TranslationKey } from '../../i18n';
import { dialogPaperClass, dialogParts } from '../../styles/dialog';
import motionStyles from '../../styles/dialog-motion.module.css';
import { useI18nStore } from '../../stores/i18n-store';
import { useMotionStore } from '../../stores/motion-store';
import styles from './BoardControls.module.css';

/** What the viewer may do about the match right now; null for spectators and finished games. */
export interface BoardControls {
  readonly resign: (() => void) | null;
  /** Absent when the game has no draw offers or more than two players. */
  readonly draw: {
    readonly block: DrawOfferBlock | null;
    /** The viewer's own offer is waiting for the opponent. */
    readonly offered: boolean;
    readonly offer: () => void;
  } | null;
  /** The opponent's offer, which the viewer can answer. */
  readonly incoming: { readonly accept: () => void; readonly decline: () => void } | null;
  /** With three or more players still in, the match goes on without the resigning seat. */
  readonly resignContinues?: boolean;
}

/** Builds the controls from the game's shared rules and draw state; `send` emits a match-control action. */
export function boardControls(
  rules: MatchControlRules | undefined, state: DrawOfferState, seat: GameSeat | null, context: MatchControlContext,
  send: (action: MatchControlAction) => void,
): BoardControls | null {
  if (!rules || seat === null || !context.seats.includes(seat)) return null;
  const twoPlayer = rules.draw && context.seats.length === 2;
  return {
    resign: rules.resign ? () => send({ type: 'resign' }) : null,
    draw: twoPlayer ? {
      block: drawOfferBlock(state, seat, context, rules),
      offered: state.offeredBy === seat,
      offer: () => send({ type: 'offer-draw' }),
    } : null,
    incoming: twoPlayer && canAnswerDraw(state, seat, context) ? {
      accept: () => send({ type: 'answer-draw', accept: true }),
      decline: () => send({ type: 'answer-draw', accept: false }),
    } : null,
  };
}

const BLOCK_HINT: Partial<Record<DrawOfferBlock, TranslationKey>> = {
  'not-your-turn': 'board.drawNotYourTurn',
  cooldown: 'board.drawCooldown',
  pending: 'board.drawOffered',
};

function ResignButton({ resign, disabled, compact, continues }: {
  readonly resign: () => void; readonly disabled: boolean; readonly compact: boolean; readonly continues: boolean;
}): ReactNode {
  const { t } = useI18nStore();
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const reducedMotion = useMotionStore((state) => state.reducedMotion);
  const systemReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const still = reducedMotion || systemReducedMotion;
  return <>
    <Button className={`${styles.action} ${styles.resign} ${compact ? styles.compact : ''}`} disabled={disabled}
      aria-haspopup="dialog" onClick={() => setOpen(true)}>{t('board.resign')}</Button>
    <Dialog open={open} onClose={() => setOpen(false)} transitionDuration={{ enter: 0, exit: still ? 0 : 200 }}
      aria-labelledby={titleId} aria-describedby={`${titleId}-description`}
      slotProps={{ paper: { className: dialogPaperClass('narrow', open ? motionStyles.enter : motionStyles.exit, still && motionStyles.still) } }}>
      <div className={dialogParts.header}><h2 id={titleId} className={styles.dialogTitle}>{t('board.resignTitle')}</h2></div>
      <div className={dialogParts.body}><p id={`${titleId}-description`}>{t(continues ? 'board.resignContinuesDescription' : 'board.resignDescription')}</p></div>
      <div className={dialogParts.footer}>
        <Button autoFocus onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
        <Button variant="primary" className={styles.confirmResign} onClick={() => {
          setOpen(false);
          resign();
        }}>{t('board.resign')}</Button>
      </div>
    </Dialog>
  </>;
}

/** 提和 and 認輸; the draw button stays visible but disabled, with the reason, when an offer is not allowed. */
export function MatchButtons({ controls, disabled = false, compact = false }: {
  readonly controls: BoardControls; readonly disabled?: boolean; readonly compact?: boolean;
}): ReactNode {
  const { t } = useI18nStore();
  const draw = controls.draw;
  const hint = draw?.offered ? 'board.drawOffered' : draw?.block ? BLOCK_HINT[draw.block] : undefined;
  return <div className={`${styles.buttons} ${compact ? styles.compactRow : ''}`}>
    {draw && <Button className={`${styles.action} ${compact ? styles.compact : ''}`}
      disabled={disabled || draw.block !== null} title={hint ? t(hint) : undefined}
      aria-description={hint ? t(hint) : undefined} onClick={draw.offer}>{t('board.offerDraw')}</Button>}
    {controls.resign && <ResignButton resign={controls.resign} disabled={disabled} compact={compact}
      continues={controls.resignContinues ?? false} />}
  </div>;
}

/** The opponent's draw offer; moving instead of answering declines it. */
export function DrawOfferPrompt({ incoming, disabled = false, compact = false }: {
  readonly incoming: NonNullable<BoardControls['incoming']>; readonly disabled?: boolean; readonly compact?: boolean;
}): ReactNode {
  const { t } = useI18nStore();
  const titleId = useId();
  return <section className={`${styles.offer} ${compact ? styles.offerCompact : ''}`} role="alertdialog" aria-labelledby={titleId}
    aria-describedby={`${titleId}-hint`}>
    <div className={styles.offerText}>
      <strong id={titleId}>{t('board.drawOfferTitle')}</strong>
      <span id={`${titleId}-hint`}>{t('board.drawOfferHint')}</span>
    </div>
    <div className={styles.offerButtons}>
      <Button variant="success" className={compact ? styles.compact : ''} disabled={disabled} onClick={incoming.accept}>
        {t('board.drawAccept')}</Button>
      <Button className={compact ? styles.compact : ''} disabled={disabled} onClick={incoming.decline}>{t('board.drawDecline')}</Button>
    </div>
  </section>;
}

/** The 「待確認：…」 line with the fixed 確認 button; tapping the destination again also confirms. */
export function PendingMove({ text, onConfirm, onCancel, disabled = false }: {
  readonly text: string; readonly onConfirm: () => void; readonly onCancel: () => void; readonly disabled?: boolean;
}): ReactNode {
  const { t } = useI18nStore();
  return <div className={styles.pending}>
    <p className={styles.pendingText} role="status">{t('board.pending')}<strong>{text}</strong></p>
    <div className={styles.pendingButtons}>
      <Button variant="primary" className={styles.confirm} disabled={disabled} onClick={onConfirm}>{t('board.confirm')}</Button>
      <Button className={styles.cancel} onClick={onCancel}>{t('board.cancel')}</Button>
    </div>
  </div>;
}
