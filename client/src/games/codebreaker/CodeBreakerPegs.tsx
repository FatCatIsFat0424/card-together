import type { CSSProperties, ReactNode } from 'react';
import { CB_SLOTS } from '@shared/rules/codebreaker';
import type { CbCode, CbVariant } from '@shared/rules/codebreaker';
import { useI18nStore } from '../../stores/i18n-store';
import type { TranslationKey } from '../../i18n';
import styles from './CodeBreakerPegs.module.css';

/** Colour pegs differ in shape as well as colour, so the code reads without telling the colours apart. */
const PEG_SHAPES: readonly ReactNode[] = [
  <circle key="circle" cx="12" cy="12" r="9.5" />,
  <rect key="square" x="3.5" y="3.5" width="17" height="17" rx="2" />,
  <polygon key="triangle" points="12,3 21.5,20 2.5,20" />,
  <polygon key="diamond" points="12,2.5 21.5,12 12,21.5 2.5,12" />,
  <polygon key="star" points="12,2.5 14.9,8.6 21.6,9.4 16.6,14 18,20.6 12,17.3 6,20.6 7.4,14 2.4,9.4 9.1,8.6" />,
  <polygon key="hexagon" points="12,2.5 20.2,7.2 20.2,16.8 12,21.5 3.8,16.8 3.8,7.2" />,
];

/** Red, blue, green, yellow, purple, orange: each shape above has its own hue, tuned to stay apart for common colour blindness. */
const PEG_COLORS: readonly string[] = ['#e5484d', '#3e63dd', '#30a46c', '#f5c518', '#8e4ec6', '#f76b15'];

const COLOR_LABELS: readonly TranslationKey[] = [
  'codebreaker.color0', 'codebreaker.color1', 'codebreaker.color2',
  'codebreaker.color3', 'codebreaker.color4', 'codebreaker.color5',
];

/** The accessible name of one symbol. */
export function useSymbolLabel(): (variant: CbVariant, symbol: number) => string {
  const { t } = useI18nStore();
  return (variant, symbol) => (variant === 'digits' ? t('codebreaker.digitKey', { n: String(symbol) }) : t(COLOR_LABELS[symbol]));
}

/** One digit tile or colour peg. */
export function CodeToken({ variant, symbol }: { readonly variant: CbVariant; readonly symbol: number }): ReactNode {
  if (variant === 'digits') return <span className={styles.digit} aria-hidden="true">{symbol}</span>;
  return <svg className={styles.peg} viewBox="0 0 24 24" aria-hidden="true" focusable="false"
    style={{ '--peg': PEG_COLORS[symbol] } as CSSProperties}>{PEG_SHAPES[symbol]}</svg>;
}

/** A whole code as one labelled row of tokens. */
export function CodeRow({ variant, code, label }: {
  readonly variant: CbVariant; readonly code: CbCode; readonly label: string;
}): ReactNode {
  return <span className={styles.row} role="img" aria-label={label}>
    {code.map((symbol, slot) => <span key={slot} className={styles.cell}><CodeToken variant={variant} symbol={symbol} /></span>)}
  </span>;
}

/** The accessible text of a code, such as "Digit 1, digit 2, digit 3, digit 4". */
export function useCodeLabel(): (variant: CbVariant, code: CbCode) => string {
  const symbolLabel = useSymbolLabel();
  return (variant, code) => code.map((symbol) => symbolLabel(variant, symbol)).join(', ');
}

/** Digits read 1A2B; colours show one filled pip per exact match and one ring per colour in the wrong slot. */
export function FeedbackMark({ variant, exact, partial }: {
  readonly variant: CbVariant; readonly exact: number; readonly partial: number;
}): ReactNode {
  const { t } = useI18nStore();
  const label = t('codebreaker.feedbackLabel', { exact: String(exact), partial: String(partial) });
  if (variant === 'digits') {
    return <span className={styles.feedbackText} role="img" aria-label={label} title={label}>
      {t('codebreaker.feedbackDigits', { a: String(exact), b: String(partial) })}
    </span>;
  }
  return <span className={styles.pips} role="img" aria-label={label} title={label}>
    {Array.from({ length: CB_SLOTS }, (_, index) => <span key={index}
      className={`${styles.pip} ${index < exact ? styles.exact : index < exact + partial ? styles.partial : styles.none}`} />)}
  </span>;
}
