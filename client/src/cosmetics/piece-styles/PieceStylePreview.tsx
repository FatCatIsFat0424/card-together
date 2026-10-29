import { useId } from 'react';
import type { ReactNode } from 'react';
import type { PieceStyleId } from '@shared/types';
import { boardThemeStyle } from '../../games/board/board-theme';
import { PieceFinishContext, StonePiece, TokenPiece } from '../../games/board/BoardPieces';
import { boardThemeFor } from '../board-styles/board-theme-for';
import type { PreviewAccount } from '../preview-props';
import { PIECE_DESIGNS } from './piece-designs';
import styles from './PieceStylePreview.module.css';

const WIDTH = 3.6;
const HEIGHT = 1.8;

/**
 * Both Xiangqi sides and both stones, drawn large on a ground tinted by the series: lettering font, rim, gloss,
 * and colours are what tell the styles apart at card size, so nothing small or fixed-colour is shown.
 */
export function PieceStylePreview({ id }: { readonly id: PieceStyleId; readonly account: PreviewAccount }): ReactNode {
  const theme = boardThemeFor(null, id);
  const { finish, stage } = PIECE_DESIGNS[id];
  const glowId = useId();
  return (
    <svg className={styles.preview} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} style={boardThemeStyle(theme, 'wood')}
      aria-hidden="true" focusable="false" data-piece-style={id}>
      <defs>
        <radialGradient id={glowId} cx="0.4" cy="0.5" r="0.65">
          <stop offset="0" stopColor={stage.glow} stopOpacity="0.55" />
          <stop offset="1" stopColor={stage.glow} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x={0} y={0} width={WIDTH} height={HEIGHT} rx={0.2} fill={stage.ground} />
      <rect x={0} y={0} width={WIDTH} height={HEIGHT} rx={0.2} fill={`url(#${glowId})`} />
      <PieceFinishContext.Provider value={finish}>
        <g transform="translate(0.85 0.9) scale(1.4)"><TokenPiece tone="red" label="帥" /></g>
        <g transform="translate(2.05 0.9) scale(1.4)"><TokenPiece tone="black" label="將" /></g>
        <g transform="translate(3 0.5)"><StonePiece tone="dark" /></g>
        <g transform="translate(3 1.3)"><StonePiece tone="light" /></g>
      </PieceFinishContext.Provider>
    </svg>
  );
}
