// ─── LiarsDeckHistory: each round's claims, the LIAR call, and the trigger pull ───

import type { ReactNode } from 'react';
import type { GameSeat } from '@shared/types';
import { useI18nStore } from '../../stores/i18n-store';
import {
  CardBacks, ChipRow, HistoryAction, HistoryActions, HistoryNote, HistoryOngoing, HistoryResult, HistoryRounds, HistoryTag,
  TextChip,
} from '../HistoryRounds';
import type { HistoryRound } from '../round-history';
import { useSeatName } from '../seat-names';

export function LiarsDeckRounds({ rounds, mySeat }: {
  rounds: readonly HistoryRound[]; mySeat: GameSeat | null;
}): ReactNode {
  const { t } = useI18nStore();
  const name = useSeatName();
  return <HistoryRounds rounds={rounds} summary={(round) => {
    const shot = round.actions.find((action) => action.kind === 'shot');
    const outcome = shot?.seat
      ? t(shot.survived ? 'liarsdeck.historySurvived' : 'liarsdeck.historyKilled', { name: name(shot.seat) }) : '';
    return <>
      {round.tableFace && <HistoryTag>{t('presentation.tableFace', { face: t(`liarsdeck.face.${round.tableFace}`) })}</HistoryTag>}
      {outcome ? <HistoryResult tone={shot?.survived ? 'neutral' : 'danger'} title={outcome}>{outcome}</HistoryResult>
        : !round.complete && <HistoryOngoing />}
    </>;
  }}>{(round) => <HistoryActions>{round.actions.map((action, index) => {
    if (!action.seat) return null;
    const row = { name: name(action.seat), nameTitle: name(action.seat), mine: action.seat === mySeat };
    if (action.kind === 'challenge') {
      return <HistoryAction key={index} {...row} marks={<HistoryTag tone={action.lied ? 'danger' : 'success'}>
        {t(action.lied ? 'liarsdeck.logLied' : 'liarsdeck.logHonest')}</HistoryTag>}>
        <HistoryNote>{t('liarsdeck.historyCall', { name: action.target ? name(action.target) : '' })}</HistoryNote>
        {action.faces && <ChipRow>{action.faces.map((face, faceIndex) => <TextChip key={faceIndex} red={face === 'joker'}
          off={face !== 'joker' && face !== round.tableFace}>{t(`liarsdeck.face.${face}`)}</TextChip>)}</ChipRow>}
      </HistoryAction>;
    }
    if (action.kind === 'shot') {
      return <HistoryAction key={index} {...row} state={action.survived ? 'muted' : 'lost'}>
        <HistoryNote>{t(action.survived ? 'liarsdeck.logSurvived' : 'liarsdeck.logKilled', { n: String(action.shot) })}</HistoryNote>
      </HistoryAction>;
    }
    return <HistoryAction key={index} {...row}>
      <CardBacks count={action.count ?? 0} label={t('liarsdeck.logPlay', { n: String(action.count ?? 0) })} />
    </HistoryAction>;
  })}</HistoryActions>}</HistoryRounds>;
}
