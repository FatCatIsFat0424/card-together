import type { ReactNode } from 'react';
import type { GameCategory } from '@shared/games/game-definition';
import type { GameType } from '@shared/types';
import { gamesInCategory, lobbyCategories, playersLabel } from '../games/registry';
import { useI18nStore } from '../stores/i18n-store';
import { Tabs, tabElementId } from './Tabs';
import styles from './RoomGamePicker.module.css';

const TAB_PREFIX = 'room-game';
const PANEL_ID = 'room-game-panel';

interface RoomGamePickerProps {
  readonly gameType: GameType;
  /** Category whose games are listed. */
  readonly category: GameCategory;
  readonly onCategoryChange: (category: GameCategory) => void;
  readonly onSelect: (gameType: GameType) => void;
  readonly disabled: boolean;
  /**
   * A request is in flight: input is locked but the chips stay focusable and enabled-looking,
   * because a disabled button would drop keyboard focus out of the popover.
   */
  readonly pending?: boolean;
  /** Explains a read-only picker. */
  readonly title?: string;
}

/** Game picker of the room settings: lobby category tabs over text chips with the seat count. */
export function RoomGamePicker({
  gameType, category, onCategoryChange, onSelect, disabled, pending, title,
}: RoomGamePickerProps): ReactNode {
  const { t } = useI18nStore();
  return <div className={styles.picker}>
    <Tabs label={t('lobby.categories')} idPrefix={TAB_PREFIX} controls={PANEL_ID} value={category}
      onChange={onCategoryChange} tabs={lobbyCategories().map((id) => ({ id, label: t(`lobby.category.${id}`) }))} />
    <div id={PANEL_ID} role="tabpanel" aria-labelledby={tabElementId(TAB_PREFIX, category)} title={title}
      className={styles.chips}>
      {gamesInCategory(category).map((game) => <button key={game} type="button"
        className={`${styles.chip} ${game === gameType ? styles.selected : ''}`}
        aria-pressed={game === gameType} disabled={disabled && !pending}
        aria-disabled={disabled && pending ? true : undefined} data-pending-disabled={disabled && pending ? true : undefined}
        onClick={() => { if (!disabled) onSelect(game); }}>
        {t(`gameType.${game}`)}
        <span className={styles.count}>{playersLabel(game, t)}</span>
      </button>)}
    </div>
  </div>;
}
