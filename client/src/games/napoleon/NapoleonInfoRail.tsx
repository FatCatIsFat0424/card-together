// ─── NapoleonInfoRail: contract, side progress, discards, tricks, and the auction ───

import type { ReactNode } from 'react';
import { NAPOLEON_MIN_LEVEL, NAPOLEON_POINT_CARDS } from '@shared/rules/napoleon';
import type { NapoleonVisibleState } from '@shared/types';
import { AuctionTable, BidLabel } from '../../components/AuctionTable';
import railStyles from '../../components/GameInfoRail.module.css';
import { useI18nStore } from '../../stores/i18n-store';
import { CardLabel } from '../CardLabel';
import { useSeatName } from '../seat-names';
import { useGamePresentation } from '../use-game-presentation';
import { useNapoleonCardImageUrl } from './napoleon-card-art';
import { napoleonAuctionColumns, napoleonCardText, napoleonFinalTricks, napoleonPresentedSidePoints } from './napoleon-view';
import { NapoleonTrickHistory } from './NapoleonTrickHistory';
import styles from './NapoleonTable.module.css';
import infoStyles from './NapoleonInfoRail.module.css';

function SideProgress({ label, count, target, team, pending, pendingDiscards = false }: {
  label: string; count: number | null; target: number; team: 'ns' | 'ew'; pending: string; pendingDiscards?: boolean;
}): ReactNode {
  return <div className={`${infoStyles.scoreRow} ${team === 'ns' ? railStyles.nsText : railStyles.ewText}`}>
    <span className={infoStyles.team}>{label}</span>
    <span className={railStyles.pips} role="progressbar" aria-label={label} aria-valuemin={0}
      aria-valuemax={target} aria-valuenow={count === null ? undefined : Math.min(count, target)}
      aria-valuetext={count === null ? pending : `${count}${pendingDiscards ? '+' : ''} / ${target}`}>
      {Array.from({ length: target }, (_, index) => <span key={index}
        className={`${railStyles.pip} ${count !== null && index < count ? railStyles[team] : ''}`} />)}
    </span>
    <span className={infoStyles.count}>{count === null ? '—' : `${count}${pendingDiscards ? '+' : ''}`} / {target}</span>
  </div>;
}

export function NapoleonInfoRail({ game }: { game: NapoleonVisibleState }): ReactNode {
  const napoleonCardImageUrl = useNapoleonCardImageUrl();
  const { t } = useI18nStore();
  const name = useSeatName();
  const { frame } = useGamePresentation();
  const jokerName = (joker: 'big' | 'small'): string => t(`napoleon.joker.${joker}`);
  const { contract } = game;
  const points = napoleonPresentedSidePoints(game, frame);
  const showProgress = game.phase === 'playing' || game.phase === 'scoring';

  return (
    <aside className={railStyles.rail}>
      <section className={railStyles.box}>
        <h2 className={railStyles.caption}>{t('game.contract')}</h2>
        {contract ? <>
          <div className={railStyles.contractMain}>
            <span className={railStyles.big}><BidLabel level={contract.level} suit={contract.suit} /></span>
            <span className={railStyles.meta}>
              <span className={`${styles.roleBadge} ${styles.napoleonBadge}`}>{t('napoleon.napoleon')}</span>
              {' '}{name(contract.napoleon)}
            </span>
          </div>
          {!showProgress && <div className={railStyles.kv}>
            <span>{t('napoleon.target', { n: String(contract.level) })}</span>
            {contract.suit === 'nt' && <span>{t('napoleon.noTrump')}</span>}
          </div>}
          <div className={infoStyles.secretary}>
            <span className={railStyles.caption}>{t('napoleon.secretaryCard')}</span>
            {game.secretaryCard ? <>
              <img src={napoleonCardImageUrl(game.secretaryCard)} alt="" draggable={false} />
              <CardLabel card={game.secretaryCard} />
            </> : <span className={infoStyles.pending}>{t('napoleon.notCalled')}</span>}
          </div>
          {showProgress && <div className={infoStyles.progress}>
            <SideProgress label={t('napoleon.napoleonSide')} count={points?.napoleon ?? null}
              target={contract.level} team="ns" pending={t('napoleon.progressPending')} />
            <SideProgress label={t('napoleon.defenders')} count={points?.defenders ?? null}
              target={NAPOLEON_POINT_CARDS + 1 - contract.level} team="ew" pending={t('napoleon.progressPending')}
              pendingDiscards={points?.pendingDiscards} />
            {!points && <p className={infoStyles.note}>{t('napoleon.progressPending')}</p>}
            {points?.pendingDiscards && <p className={infoStyles.note}>{t('napoleon.progressDiscards')}</p>}
          </div>}
          {napoleonFinalTricks(game) && <p className={styles.finalNote}>{t('napoleon.finalTricks')}</p>}
        </> : <div className={railStyles.kv}>
          {game.phase === 'bidding' && <span className={railStyles.status}>{t('table.biddingNow')}</span>}
          <span>{t('table.dealerIs', { seat: name(game.dealerSeat) })}</span>
          <span>{t('napoleon.target', { n: `${NAPOLEON_MIN_LEVEL}–${NAPOLEON_POINT_CARDS}` })}</span>
        </div>}
      </section>

      {game.discards && game.discards.length > 0 && <section className={railStyles.box}>
        <h2 className={railStyles.caption}>{t('napoleon.discards')}</h2>
        <ul className={styles.cardRow} aria-label={t('napoleon.discards')}>
          {game.discards.map((card) => <li key={napoleonCardText(card, jokerName)}>
            <img src={napoleonCardImageUrl(card)} alt={napoleonCardText(card, jokerName)} draggable={false} />
          </li>)}
        </ul>
      </section>}

      <NapoleonTrickHistory game={game} />

      <section className={`${railStyles.box} ${railStyles.auction}`}>
        <h2 className={railStyles.caption}>{t('table.auction')}</h2>
        <div className={railStyles.scroll}>
          <AuctionTable calls={game.bidding?.bids ?? []} columns={napoleonAuctionColumns(game)}
            mySeat={game.observer === 'spectator' ? null : game.mySeat}
            toAct={game.phase === 'bidding' ? game.bidding?.currentBidderSeat ?? null : null} />
        </div>
      </section>
    </aside>
  );
}
