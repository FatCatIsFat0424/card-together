// ─── Promotion picker: the dialog a pawn reaching the last rank opens ───

import { useId } from 'react';
import type { ReactNode } from 'react';
import Dialog from '@mui/material/Dialog';
import useMediaQuery from '@mui/material/useMediaQuery';
import { CHESS_PROMOTIONS, chessPiece } from '@shared/rules/chess';
import type { ChessPromotion, ChessSide } from '@shared/rules/chess';
import { Button } from '../../components/Button';
import { dialogPaperClass, dialogParts } from '../../styles/dialog';
import motionStyles from '../../styles/dialog-motion.module.css';
import { useI18nStore } from '../../stores/i18n-store';
import { useMotionStore } from '../../stores/motion-store';
import { ChessPieceIcon } from './ChessPieces';
import styles from './ChessPromotion.module.css';

/** Asks which piece the pawn becomes; closing the dialog cancels the move. */
export function ChessPromotionPicker({ open, side, disabled, onPick, onCancel }: {
  readonly open: boolean;
  /** Colour of the promoting pawn, so the choices are drawn in it */
  readonly side: ChessSide;
  readonly disabled: boolean;
  readonly onPick: (piece: ChessPromotion) => void;
  readonly onCancel: () => void;
}): ReactNode {
  const { t } = useI18nStore();
  const titleId = useId();
  const reducedMotion = useMotionStore((state) => state.reducedMotion);
  const systemReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const still = reducedMotion || systemReducedMotion;
  return <Dialog open={open} onClose={onCancel} transitionDuration={{ enter: 0, exit: still ? 0 : 200 }}
    aria-labelledby={titleId} aria-describedby={`${titleId}-description`}
    slotProps={{ paper: { className: dialogPaperClass('narrow', open ? motionStyles.enter : motionStyles.exit, still && motionStyles.still) } }}>
    <div className={dialogParts.header}><h2 id={titleId} className={styles.title}>{t('chess.promoteTitle')}</h2></div>
    <div className={dialogParts.body}>
      <p id={`${titleId}-description`} className={styles.hint}>{t('chess.promoteHint')}</p>
      <div className={styles.choices}>
        {CHESS_PROMOTIONS.map((kind) => {
          const name = t(`chess.piece.${kind}`);
          return <button key={kind} type="button" className={styles.choice} disabled={disabled}
            aria-label={t('chess.promoteTo', { piece: name })} onClick={() => onPick(kind)}>
            <ChessPieceIcon piece={chessPiece(side, kind)} className={styles.piece} />
            <span>{name}</span>
          </button>;
        })}
      </div>
    </div>
    <div className={dialogParts.footer}><Button autoFocus onClick={onCancel}>{t('common.cancel')}</Button></div>
  </Dialog>;
}
