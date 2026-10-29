import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import type { PieceStyleId } from '@shared/types';
import { boardThemeStyle } from '../../games/board/board-theme';
import { FxPreview } from '../../games/board/BoardEffects';
import { PieceFinishContext, StonePiece, TokenPiece } from '../../games/board/BoardPieces';
import { useStillArt } from '../art-layers/art-layers';
import { boardThemeFor } from '../board-styles/board-theme-for';
import type { PreviewAccount } from '../preview-props';
import { PIECE_DESIGNS } from './piece-designs';
import styles from './PieceStylePreview.module.css';

const WIDTH = 3.6;
const HEIGHT = 1.8;

/** Token centres and their highlight size in the preview, as percentages of its width and height. */
const RED_AT = { left: (0.85 / WIDTH) * 100, top: 50, width: ((1.3 * 1.4 * 0.84) / WIDTH) * 100 };
const BLACK_AT = { left: (2.05 / WIDTH) * 100, top: 50, width: ((1.7 * 1.4 * 0.84) / WIDTH) * 100 };

/**
 * Both Xiangqi sides and both stones, drawn large on a ground tinted by the series: lettering font, rim, gloss,
 * and colours are what tell the styles apart at card size, so nothing small or fixed-colour is shown. The
 * style's effects play over them: the selection aura and a capture burst, again on hover.
 */
export function PieceStylePreview({ id }: { readonly id: PieceStyleId; readonly account: PreviewAccount }): ReactNode {
  const theme = boardThemeFor(null, id);
  const { finish, stage, effects } = PIECE_DESIGNS[id];
  const glowId = useId();
  const still = useStillArt();
  const [replay, setReplay] = useState(0);
  return (
    <span className={styles.frame} onPointerEnter={() => setReplay((count) => count + 1)}>
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
      {!still && <FxPreview effects={effects} aura={RED_AT} burst={BLACK_AT} replay={replay} />}
    </span>
  );
}
