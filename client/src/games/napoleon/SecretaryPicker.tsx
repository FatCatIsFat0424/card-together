// ─── SecretaryPicker: the Napoleon names any of the 54 cards ───

import { useState } from 'react';
import type { ReactNode } from 'react';
import { RANK_DISPLAY, SUIT_SYMBOLS } from '@shared/constants';
import { isNapoleonJoker, sameNapoleonCard } from '@shared/rules/napoleon';
import type { NapoleonCard, NapoleonVisibleState } from '@shared/types';
import { useI18nStore } from '../../stores/i18n-store';
import { useNapoleonCardImageUrl } from './napoleon-card-art';
import {
  NAPOLEON_PICKER_GROUPS, napoleonCardText, napoleonPickerCards, napoleonPickerGroup, napoleonPickerNote, napoleonTrump,
} from './napoleon-view';
import type { NapoleonPickerGroup } from './napoleon-view';
import styles from './NapoleonTable.module.css';

/** Pick a suit (or the jokers), then a card, then confirm; the confirm button names the card. */
export function SecretaryPicker({ game, disabled, onConfirm }: {
  game: NapoleonVisibleState;
  disabled: boolean;
  onConfirm: (card: NapoleonCard) => void;
}): ReactNode {
  const napoleonCardImageUrl = useNapoleonCardImageUrl();
  const { t } = useI18nStore();
  const [picked, setPicked] = useState<NapoleonCard | null>(null);
  const [groupPick, setGroupPick] = useState<NapoleonPickerGroup | null>(null);
  const group = groupPick ?? (picked ? napoleonPickerGroup(picked) : napoleonTrump(game) ?? 'spades');
  const jokerName = (joker: 'big' | 'small'): string => t(`cards.joker.${joker}`);
  const note = picked && napoleonPickerNote(game, picked);

  return (
    <section className={styles.panel} aria-labelledby="napoleon-call-title">
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle} id="napoleon-call-title">{t('napoleon.callTitle')}</span>
      </div>
      <p className={styles.panelHint}>{t('napoleon.callHint')}</p>
      <div className={styles.pickerGroups} role="group" aria-label={t('napoleon.pickSuit')}>
        {NAPOLEON_PICKER_GROUPS.map((value) => (
          <button key={value} type="button" className={`${styles.choiceBtn} ${value === 'hearts' || value === 'diamonds'
            ? styles.redSuit : ''}`} aria-pressed={group === value} disabled={disabled}
            onClick={() => setGroupPick(value)}>
            {value === 'joker' ? t('cards.jokers') : SUIT_SYMBOLS[value]}
          </button>
        ))}
      </div>
      <div className={`${styles.pickerCards} ${group === 'joker' ? styles.pickerJokers : ''}`} role="group"
        aria-label={t('napoleon.pickRank')}>
        {napoleonPickerCards(group).map((card) => {
          const mark = napoleonPickerNote(game, card);
          return <button key={napoleonCardText(card, jokerName)} type="button"
            className={`${styles.choiceBtn} ${mark ? styles.ownCard : ''}`}
            aria-pressed={picked !== null && sameNapoleonCard(picked, card)} disabled={disabled}
            aria-label={napoleonCardText(card, jokerName)}
            title={mark ? t(mark === 'hand' ? 'napoleon.callInHand' : 'napoleon.callDiscarded') : undefined}
            onClick={() => setPicked(card)}>
            {isNapoleonJoker(card) ? jokerName(card.joker) : RANK_DISPLAY[card.rank]}
          </button>;
        })}
      </div>
      <div className={styles.pickerPreview}>
        {picked ? <img src={napoleonCardImageUrl(picked)} alt="" draggable={false} />
          : <span className={styles.previewEmpty} aria-hidden="true" />}
        <p className={note ? styles.warning : styles.panelHint} aria-live="polite">
          {picked ? note ? t(note === 'hand' ? 'napoleon.callInHand' : 'napoleon.callDiscarded')
            : napoleonCardText(picked, jokerName) : t('napoleon.callPick')}
        </p>
      </div>
      <button type="button" className={styles.confirmBtn} disabled={disabled || !picked}
        onClick={() => picked && onConfirm(picked)}>
        {picked ? t('napoleon.callConfirm', { card: napoleonCardText(picked, jokerName) }) : t('bidding.confirm')}
      </button>
    </section>
  );
}
