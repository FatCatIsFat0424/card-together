import { useId } from 'react';
import type { ReactNode } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import type { GameType } from '@shared/types';
import { getGameRules } from '../game-rules-i18n';
import type { GameRulesContext } from '../game-rules-context';
import { useI18nStore } from '../stores/i18n-store';
import { useMotionStore } from '../stores/motion-store';
import { AppIcon } from './AppIcon';
import styles from './GameRulesDialog.module.css';
import motionStyles from '../styles/dialog-motion.module.css';

export function GameRulesContent({ gameType, context }: {
  readonly gameType: GameType;
  readonly context?: GameRulesContext;
}): ReactNode {
  const { locale, t } = useI18nStore();
  return <article className={styles.rules}>
    {context?.option && <section className={styles.roomSettings}>
      <h3>{t('rules.roomSettings')}</h3>
      <dl className={styles.option}>
        <dt>{t(context.option.label)}</dt>
        <dd>{t(context.option.enabled ? 'rules.enabled' : 'rules.disabled')}</dd>
      </dl>
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

export function GameRulesDialog({ gameType, context, onClose }: {
  readonly gameType: GameType;
  readonly context?: GameRulesContext;
  readonly onClose: () => void;
}): ReactNode {
  const { t } = useI18nStore();
  const titleId = useId();
  const reducedMotion = useMotionStore((state) => state.reducedMotion);
  return <Dialog open fullWidth maxWidth="md" onClose={onClose} aria-labelledby={titleId}
    transitionDuration={0} slotProps={{ paper: { className: `${styles.dialog} ${motionStyles.enter} ${reducedMotion ? motionStyles.still : ''}` },
      backdrop: { className: styles.backdrop } }}>
    <DialogTitle component="div" id={`${titleId}-header`} className={styles.header}>
      <h2 id={titleId}>{t('lobby.rulesTitle', { game: t(`gameType.${gameType}`) })}</h2>
      <button type="button" className={`btn btn-secondary ${styles.close}`} onClick={onClose} aria-label={t('table.close')}>
        <AppIcon name="close" />
      </button>
    </DialogTitle>
    <DialogContent dividers className={styles.content}>
      <GameRulesContent gameType={gameType} context={context} />
    </DialogContent>
  </Dialog>;
}
