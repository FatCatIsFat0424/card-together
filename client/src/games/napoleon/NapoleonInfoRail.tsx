// ─── NapoleonInfoRail: contract, secretary card, discards, and the auction ───

import type { ReactNode } from 'react';
import { NAPOLEON_MIN_LEVEL, NAPOLEON_POINT_CARDS } from '@shared/rules/napoleon';
import type { NapoleonVisibleState } from '@shared/types';
import { AuctionTable, BidLabel } from '../../components/AuctionTable';
import railStyles from '../../components/GameInfoRail.module.css';
import { useI18nStore } from '../../stores/i18n-store';
import { useSeatName } from '../seat-names';
import { napoleonCardImageUrl } from './napoleon-card-art';
import { napoleonAuctionColumns, napoleonCardText, napoleonFinalTricks } from './napoleon-view';
import styles from './NapoleonTable.module.css';

export function NapoleonInfoRail({ game }: { game: NapoleonVisibleState }): ReactNode {
  const { t } = useI18nStore();
  const name = useSeatName();
  const jokerName = (joker: 'big' | 'small'): string => t(`napoleon.joker.${joker}`);
  const { contract } = game;

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
          <div className={railStyles.kv}>
            <span>{t('napoleon.target', { n: String(contract.level) })}</span>
            {contract.suit === 'nt' && <span>{t('napoleon.noTrump')}</span>}
          </div>
          {napoleonFinalTricks(game) && <p className={styles.finalNote}>{t('napoleon.finalTricks')}</p>}
        </> : <div className={railStyles.kv}>
          {game.phase === 'bidding' && <span className={railStyles.status}>{t('table.biddingNow')}</span>}
          <span>{t('table.dealerIs', { seat: name(game.dealerSeat) })}</span>
          <span>{t('napoleon.target', { n: `${NAPOLEON_MIN_LEVEL}–${NAPOLEON_POINT_CARDS}` })}</span>
        </div>}
      </section>

      {contract && <section className={railStyles.box}>
        <h2 className={railStyles.caption}>{t('napoleon.secretaryCard')}</h2>
        {game.secretaryCard ? <div className={styles.railCard}>
          <img src={napoleonCardImageUrl(game.secretaryCard)} alt="" draggable={false} />
          <span>{napoleonCardText(game.secretaryCard, jokerName)}</span>
        </div> : <p className={railStyles.kv}>{t('napoleon.notCalled')}</p>}
      </section>}

      {game.discards && game.discards.length > 0 && <section className={railStyles.box}>
        <h2 className={railStyles.caption}>{t('napoleon.discards')}</h2>
        <ul className={styles.cardRow} aria-label={t('napoleon.discards')}>
          {game.discards.map((card) => <li key={napoleonCardText(card, jokerName)}>
            <img src={napoleonCardImageUrl(card)} alt={napoleonCardText(card, jokerName)} draggable={false} />
          </li>)}
        </ul>
      </section>}

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
