// ─── NapoleonTrickHistory: the deal's tricks with Napoleon roles marked ───

import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { SUIT_SYMBOLS } from '@shared/constants';
import type { NapoleonSummon, NapoleonVisibleState } from '@shared/types';
import railStyles from '../../components/GameInfoRail.module.css';
import { useI18nStore } from '../../stores/i18n-store';
import { suitClass } from '../CardLabel';
import { TrickHistoryTable, trickHistoryColumns } from '../TrickHistoryTable';
import type { TrickHistoryRole, TrickHistoryRow } from '../TrickHistoryTable';
import { useGamePresentation } from '../use-game-presentation';
import { napoleonCardText, napoleonPresentedEnd, napoleonSeatLabels, napoleonTrickHistory } from './napoleon-view';

const SUMMON_KEYS = {
  secretary: 'napoleon.secretary', bigJoker: 'napoleon.joker.big', smallJoker: 'napoleon.joker.small',
} as const satisfies Record<NapoleonSummon, string>;

export function NapoleonTrickHistory({ game }: { game: NapoleonVisibleState }): ReactNode {
  const { t } = useI18nStore();
  const { frame } = useGamePresentation();
  // Follow the presentation so a trick's cards and winner are not listed before their frames.
  const end = napoleonPresentedEnd(game.log, frame);
  const tricks = useMemo(() => napoleonTrickHistory(game.log.slice(0, end)), [game.log, end]);
  const labels = napoleonSeatLabels(game, frame);

  const rows: TrickHistoryRow[] = tricks.map((trick) => {
    const notes = [
      trick.namedSuit && <span key="suit">{t('napoleon.historyLead')}{' '}
        <span className={suitClass(trick.namedSuit)}>{SUIT_SYMBOLS[trick.namedSuit]}</span></span>,
      trick.summon && <span key="summon">{t('napoleon.historySummon', { target: t(SUMMON_KEYS[trick.summon]) })}</span>,
    ].filter(Boolean);
    return { ...trick, note: notes.length > 0
      ? notes.flatMap((note, index) => index === 0 ? [note] : [' · ', note]) : undefined };
  });
  const roles: TrickHistoryRole[] = [
    ...labels.napoleon ? [{ seat: labels.napoleon, label: t('napoleon.napoleon'),
      color: 'var(--badge-napoleon)', ink: 'var(--badge-napoleon-ink)' }] : [],
    ...labels.secretary ? [{ seat: labels.secretary, label: t('napoleon.secretary'),
      color: 'var(--badge-secretary)', ink: 'var(--badge-secretary-ink)' }] : [],
  ];

  return <TrickHistoryTable rows={rows} columns={trickHistoryColumns(game.seats, game.mySeat)} mySeat={game.mySeat}
    roles={roles} cardText={(card) => napoleonCardText(card, (joker) => t(`napoleon.joker.${joker}`))}
    className={railStyles.box} summaryClassName={railStyles.caption} />;
}
