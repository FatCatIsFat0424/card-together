import { useState } from 'react';
import type { ReactNode } from 'react';
import type { DiceStyleId } from '@shared/types';
import { DiceCup, Die, HiddenDie } from '../../games/liarsdice/Dice';
import type { DieFx } from '../../games/liarsdice/Dice';
import { useStillArt } from '../art-layers/art-layers';
import { diceThemeVars } from '../../games/liarsdice/dice-theme';
import type { PreviewAccount } from '../preview-props';
import { DICE_DESIGNS } from './dice-designs';
import styles from './DiceStylePreview.module.css';

/** A cup beside a roll that shows the wild one, a matched die, and a hidden die; the roll lands again on hover. */
export function DiceStylePreview({ id }: { readonly id: DiceStyleId; readonly account: PreviewAccount }): ReactNode {
  const theme = DICE_DESIGNS[id];
  const still = useStillArt();
  const [replay, setReplay] = useState(0);
  const fx = (index: number, wild = false): DieFx | null => (still || !theme.effects ? null
    : { kind: 'land', delay: index * 70, wild, loop: theme.effects.loop });
  return (
    <div className={styles.preview} style={diceThemeVars(theme)} aria-hidden="true" data-dice-style={id}
      onPointerEnter={() => setReplay((count) => count + 1)}>
      <DiceCup className={styles.cup} glow={theme.cupGlow !== null} />
      <span className={styles.dice}>
        <Die key={`a${replay}`} value={1} fx={fx(0, true)} />
        <Die key={`b${replay}`} value={4} state="match" fx={fx(1)} />
        <Die key={`c${replay}`} value={6} fx={fx(2)} />
        <HiddenDie />
      </span>
    </div>
  );
}
