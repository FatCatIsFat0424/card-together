import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { COLLECTION_STAMP_TARGETS, EXPERIENCE_PER_GAME, FAMILIARITY_TARGETS, MAX_PLAYER_LEVEL, PROGRESSION_GAME_TYPES, PROGRESSION_REWARDS } from '@shared/constants/progression';
import type { ProgressionGameType, ProgressionRewardId } from '@shared/constants/progression';
import type { ProgressionStatus } from '@shared/types';
import { useI18nStore } from '../stores/i18n-store';
import { Button } from './Button';
import { Nameplate } from './Nameplate';
import styles from './ProgressionDetails.module.css';

interface ProgressionDetailsProps {
  readonly status: ProgressionStatus;
  readonly pending: ProgressionRewardId | null;
  readonly onClaim: (id: ProgressionRewardId) => void;
  readonly busy?: boolean;
}

const STAGE_KEYS = ['progression.stage.0', 'progression.stage.1', 'progression.stage.2',
  'progression.stage.3', 'progression.stage.4', 'progression.stage.5'] as const;
function Coverage({ since, tracked }: { readonly since: number | null; readonly tracked: boolean }): ReactNode {
  const { t, locale } = useI18nStore();
  return <p className={styles.note}>{since !== null
    ? t('progression.coverage', { date: new Date(since).toLocaleDateString(locale) })
    : t(tracked ? 'progression.coverageAll' : 'progression.coveragePending')}</p>;
}

function Rewards({ status, pending, onClaim, kind, busy }: ProgressionDetailsProps & {
  readonly kind: 'growth' | 'collection';
}): ReactNode {
  const { t } = useI18nStore();
  const rewards = PROGRESSION_REWARDS.filter((reward) => kind === 'collection' ? reward.kind === 'collection' : reward.kind !== 'collection');
  return <section aria-label={t('progression.rewards')}>
    <h2>{t('progression.rewards')}</h2>
    <p className={styles.note}>{t('progression.manual')}</p>
    <ul className={styles.rewards}>{rewards.map((reward) => {
      const state = status.rewards.find((entry) => entry.id === reward.id);
      const title = t(`shop.title.${reward.nameplate}`);
      const target = reward.kind === 'level' ? t('progression.levelTarget', { n: String(reward.target) })
        : reward.kind === 'collection' ? t('progression.collectionTarget', { n: String(reward.target) })
          : t('progression.familiarityTarget', { game: t(`gameType.${reward.gameType}`), n: String(reward.target) });
      return <li key={reward.id} className={styles.reward} data-reward={reward.id}
        data-state={state?.claimed ? 'claimed' : state?.eligible ? 'eligible' : 'locked'}>
        <Nameplate id={reward.nameplate} />
        <span className={styles.note}>{target}</span>
        {state?.claimed ? <><span className={styles.claimed}>{t('achievements.claimed')}</span>
          <Link to="/account">{t('achievements.equip')}</Link></>
          : state?.eligible ? <><span className={styles.ready}>{t('progression.eligible')}</span>
            <Button size="small" disabled={busy || pending !== null} aria-label={t('progression.claim', { title })}
              onClick={() => onClaim(reward.id)}>{pending === reward.id ? t('progression.claiming') : t('achievements.claim')}</Button></>
            : <span className={styles.note}>{t('progression.locked')}</span>}
      </li>;
    })}</ul>
  </section>;
}

export function ProgressionGrowth({ status, pending, onClaim, busy }: ProgressionDetailsProps): ReactNode {
  const { t, locale } = useI18nStore();
  const { level } = status;
  const capped = level.level >= MAX_PLAYER_LEVEL;
  return <div className={styles.content}>
    <section className={styles.level} aria-label={t('progression.level')}>
      <div className={styles.levelHeading}><span className={styles.levelNumber}>Lv.{level.level}</span>
        <div><h2>{t('progression.level')}</h2><p>{t('progression.games', { n: level.games.toLocaleString(locale) })}</p></div></div>
      {capped ? <><strong>{t('progression.cap')}</strong><p className={styles.note}>{t('progression.capHint')}</p></>
        : <><div className={styles.xp}><span>{t('progression.levelXp')}</span>
          <strong>{level.currentLevelXp.toLocaleString(locale)} / {level.nextLevelXp?.toLocaleString(locale)} XP</strong></div>
          <progress value={level.currentLevelXp} max={level.nextLevelXp ?? 1} aria-label={t('progression.levelXp')} />
          <p>{t('progression.nextLevel', { n: String(level.gamesToNextLevel), level: String(level.level + 1) })}</p></>}
      <div className={styles.xp}><span>{t('progression.totalXp')}</span>
        <strong>{BigInt(level.totalXp).toLocaleString(locale)} XP</strong></div>
      <p className={styles.note}>{t('progression.xpRule', { xp: String(EXPERIENCE_PER_GAME) })}</p>
    </section>
    <p className={styles.note}>{t('progression.skill')}</p>
    <section aria-label={t('progression.familiarity')}>
      <h2>{t('progression.familiarity')}</h2>
      <div className={styles.games}>{status.familiarity.map((entry) => <article key={entry.gameType} className={styles.card}>
        <div className={styles.cardHeading}><h3>{t(`gameType.${entry.gameType}`)}</h3>
          <strong>{t(STAGE_KEYS[entry.stage] ?? STAGE_KEYS[0])}</strong></div>
        <p>{t('progression.games', { n: entry.games.toLocaleString(locale) })}</p>
        <ol className={styles.stages}>{FAMILIARITY_TARGETS.map((target, index) => <li key={target}
          data-reached={entry.games >= target} aria-label={`${t('progression.stageTarget', { stage: t(STAGE_KEYS[index + 1] ?? STAGE_KEYS[0]), n: String(target) })}: ${t(entry.games >= target ? 'achievements.complete' : 'progression.locked')}`}>
          <span>{t(STAGE_KEYS[index + 1] ?? STAGE_KEYS[0])}</span><strong>{target}</strong>
        </li>)}</ol>
        <p className={styles.note}>{entry.nextTarget === null ? t('progression.familiarityComplete')
          : t('progression.familiarityNext', { n: String(Math.max(0, entry.nextTarget - entry.games)) })}</p>
        <Coverage since={entry.since} tracked={entry.games > 0} />
      </article>)}</div>
      <p className={styles.note}>{t('progression.history')}</p>
    </section>
    <Rewards status={status} pending={pending} onClaim={onClaim} busy={busy} kind="growth" />
  </div>;
}

export function ProgressionCollection({ status, pending, onClaim, busy }: ProgressionDetailsProps): ReactNode {
  const { t, locale } = useI18nStore();
  const [filter, setFilter] = useState<ProgressionGameType | 'all'>('all');
  const next = PROGRESSION_REWARDS.find((reward) => reward.kind === 'collection' && reward.target > status.stamps);
  const entries = status.collection.filter((entry) => filter === 'all' || entry.gameType === filter);
  return <div className={styles.content}>
    <div className={styles.albumHeading}>
      <div><strong>{t('progression.stamps', { n: String(status.stamps) })}</strong>
        <p className={styles.note}>{next ? t('progression.nextReward', { n: String(next.target - status.stamps) }) : t('progression.allRewards')}</p></div>
      <label className={styles.filter}>{t('progression.filter')}
        <select value={filter} onChange={(event) => {
          const value = event.target.value;
          const game = PROGRESSION_GAME_TYPES.find((entry) => entry === value);
          if (value === 'all') setFilter('all');
          else if (game) setFilter(game);
        }}><option value="all">{t('progression.all')}</option>
          {PROGRESSION_GAME_TYPES.map((game) => <option key={game} value={game}>{t(`gameType.${game}`)}</option>)}
        </select>
      </label>
    </div>
    {([false, true] as const).map((rare) => <section key={String(rare)} aria-label={t(rare ? 'progression.rare' : 'progression.common')}>
      <h2>{t(rare ? 'progression.rare' : 'progression.common')}</h2>
      <p className={styles.note}>{t(rare ? 'progression.rareHint' : 'progression.commonHint')}</p>
      <ul className={styles.records}>{entries.filter((entry) => entry.rare === rare).map((entry) => {
        const count = entry.tracked ? entry.count : null;
        const tracked = count !== null;
        return <li key={entry.id} className={styles.card} data-collection={entry.id}
          data-collected={count !== null && count > 0}>
          <span className={styles.note}>{t(`gameType.${entry.gameType}`)}</span>
          <h3>{t(`stats.record.${entry.id}`)}</h3>
          <p>{count !== null ? t('progression.recordCount', { n: count.toLocaleString(locale) }) : t('progression.missing')}</p>
          {rare ? <strong className={styles.note}>{count !== null ? t(count > 0 ? 'progression.collected' : 'progression.uncollected') : t('progression.missingHint')}</strong>
            : <><ol className={styles.stamps} aria-label={t('progression.common')}>{COLLECTION_STAMP_TARGETS.map((target, index) => <li key={target}
              data-reached={tracked && entry.stamps > index}
              aria-label={`${t('progression.stampTarget', { n: String(target) })}: ${t(!tracked ? 'progression.missing' : entry.stamps > index ? 'progression.collected' : 'progression.locked')}`}>
              <span aria-hidden="true">{tracked && entry.stamps > index ? '◆' : '◇'}</span>
              <span>{t('progression.stampTarget', { n: String(target) })}</span>
            </li>)}</ol>{!tracked && <p className={styles.note}>{t('progression.missingHint')}</p>}</>}
          <Coverage since={entry.since} tracked={tracked} />
        </li>;
      })}</ul>
    </section>)}
    <Rewards status={status} pending={pending} onClaim={onClaim} busy={busy} kind="collection" />
  </div>;
}
