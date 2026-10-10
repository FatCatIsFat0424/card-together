import { useId } from 'react';
import type { ReactNode } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import type { GameType } from '@shared/types';
import { getGameRules } from '../game-rules-i18n';
import { useI18nStore } from '../stores/i18n-store';
import { AppIcon } from './AppIcon';
import styles from './GameRulesDialog.module.css';

export function GameRulesContent({ gameType }: { readonly gameType: GameType }): ReactNode {
  const { locale } = useI18nStore();
  return <article className={styles.rules}>
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

export function GameRulesDialog({ gameType, onClose }: {
  readonly gameType: GameType;
  readonly onClose: () => void;
}): ReactNode {
  const { t } = useI18nStore();
  const titleId = useId();
  return <Dialog open fullWidth maxWidth="md" onClose={onClose} aria-labelledby={titleId}
    transitionDuration={0} slotProps={{ paper: { className: styles.dialog }, backdrop: { className: styles.backdrop } }}>
    <DialogTitle component="div" className={styles.header}>
      <h2 id={titleId}>{t('lobby.rulesTitle', { game: t(`gameType.${gameType}`) })}</h2>
      <button type="button" className={`btn btn-secondary ${styles.close}`} onClick={onClose} aria-label={t('table.close')}>
        <AppIcon name="close" />
      </button>
    </DialogTitle>
    <DialogContent dividers className={styles.content}>
      <GameRulesContent gameType={gameType} />
    </DialogContent>
  </Dialog>;
}
