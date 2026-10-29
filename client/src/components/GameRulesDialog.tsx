import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import useMediaQuery from '@mui/material/useMediaQuery';
import { GAME_TYPES } from '@shared/constants';
import type { GameType } from '@shared/types';
import { getGameRules } from '../game-rules-i18n';
import type { GameRulesContext } from '../game-rules-context';
import { gameRulesSummary } from '../games/rules-summary';
import { useI18nStore } from '../stores/i18n-store';
import { useMotionStore } from '../stores/motion-store';
import { AppIcon } from './AppIcon';
import { dialogPaperClass, dialogParts } from '../styles/dialog';
import styles from './GameRulesDialog.module.css';
import motionStyles from '../styles/dialog-motion.module.css';

export function GameRulesContent({ gameType, context }: {
  readonly gameType: GameType;
  readonly context?: GameRulesContext;
}): ReactNode {
  const { locale, t } = useI18nStore();
  const summary = gameRulesSummary(gameType, context, t);
  return <article className={styles.rules}>
    {summary.length > 0 && <section className={styles.summary}>
      <h3>{t('rules.summary')}</h3>
      <ul>{summary.map((line) => <li key={line}>{line}</li>)}</ul>
    </section>}
    {context?.option && <section className={styles.roomSettings}>
      <h3>{t('rules.roomSettings')}</h3>
      {[context.option, ...context.moreOptions ?? []].map((option) => <dl key={option.label} className={styles.option}>
        <dt>{t(option.label)}</dt>
        <dd>{t(option.enabled ? 'rules.enabled' : 'rules.disabled')}</dd>
      </dl>)}
    </section>}
    {context?.active && <p className={styles.playNotice}>{t('rules.playContinues')}</p>}
    {getGameRules(gameType, locale).map((section) => <section key={section.title}>
      <h3>{section.title}</h3>
      {section.table && <div className={styles.tableScroll}>
        <table aria-label={section.title}>
          <thead><tr>{section.table.headers.map((header) => <th key={header} scope="col">{header}</th>)}</tr></thead>
          <tbody>{section.table.rows.map((row) => <tr key={row.join('|')}>
            {row.map((cell, index) => index === 0
              ? <th key={index} scope="row">{cell}</th>
              : <td key={index}>{cell}</td>)}
          </tr>)}</tbody>
        </table>
      </div>}
      <ul>{section.paragraphs.map((paragraph) => <li key={paragraph}>{paragraph}</li>)}</ul>
    </section>)}
  </article>;
}

export function GameRulesDialog({ gameType, context, browseGames = false, onClose }: {
  readonly gameType: GameType;
  readonly context?: GameRulesContext;
  readonly browseGames?: boolean;
  readonly onClose: () => void;
}): ReactNode {
  const { t } = useI18nStore();
  const titleId = useId();
  const [selectedGame, setSelectedGame] = useState(gameType);
  const visibleGame = browseGames ? selectedGame : gameType;
  const reducedMotion = useMotionStore((state) => state.reducedMotion);
  const systemReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [closing, setClosing] = useState(false);
  const still = reducedMotion || systemReducedMotion;
  const close = (): void => setClosing(true);
  return <Dialog open={!closing} onClose={close} aria-labelledby={titleId}
    transitionDuration={{ enter: 0, exit: still ? 0 : 200 }}
    slotProps={{ transition: { onExited: onClose },
      paper: { className: dialogPaperClass('wide', styles.dialog, closing ? motionStyles.exit : motionStyles.enter, still && motionStyles.still) },
      backdrop: { className: styles.backdrop } }}>
    <DialogTitle component="div" id={`${titleId}-header`} className={`${dialogParts.header} ${styles.header}`}>
      <h2 id={titleId}>{browseGames ? t('rules.browseTitle') : t('lobby.rulesTitle', { game: t(`gameType.${gameType}`) })}</h2>
      <button type="button" className={`btn btn-secondary ${styles.close}`} onClick={close} aria-label={t('table.close')}>
        <AppIcon name="close" />
      </button>
    </DialogTitle>
    <DialogContent className={`${dialogParts.body} ${styles.content} ${browseGames ? styles.browser : ''}`}>
      {browseGames ? <>
        <Tabs orientation="vertical" variant="scrollable" scrollButtons={false}
          className={styles.gameTabs} value={selectedGame} aria-label={t('gameType.label')}
          onChange={(_, value: GameType) => setSelectedGame(value)}>
          {GAME_TYPES.map((game) => <Tab key={game} value={game} label={t(`gameType.${game}`)}
            id={`${titleId}-tab-${game}`} aria-controls={`${titleId}-panel-${game}`} />)}
        </Tabs>
        <div key={visibleGame} className={styles.gamePanel} role="tabpanel" tabIndex={0}
          id={`${titleId}-panel-${visibleGame}`} aria-labelledby={`${titleId}-tab-${visibleGame}`}>
          <h3 className={styles.gameTitle}>{t('lobby.rulesTitle', { game: t(`gameType.${visibleGame}`) })}</h3>
          <GameRulesContent gameType={visibleGame} context={visibleGame === gameType ? context : undefined} />
        </div>
      </> : <GameRulesContent gameType={gameType} context={context} />}
    </DialogContent>
  </Dialog>;
}
