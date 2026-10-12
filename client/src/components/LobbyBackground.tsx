import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { GAME_TYPES } from '@shared/constants';
import type { GameType } from '@shared/types';
import { GAME_BACKGROUNDS } from '../game-backgrounds';
import styles from './LobbyBackground.module.css';

interface BackgroundState {
  readonly activeGame: GameType;
  readonly loadedGames: readonly GameType[];
}

export function LobbyBackground({ gameType }: { readonly gameType: GameType }): ReactNode {
  const [background, setBackground] = useState<BackgroundState>(() => ({
    activeGame: gameType, loadedGames: [],
  }));

  useEffect(() => {
    if (gameType === background.activeGame && background.loadedGames.includes(gameType)) return;
    const image = new Image();
    // Keep the previous artwork visible until the new image is ready. Cleanup prevents
    // a slow download from replacing a newer selection during rapid mode changes.
    image.onload = () => setBackground((current) => ({
      activeGame: gameType,
      loadedGames: current.loadedGames.includes(gameType) ? current.loadedGames : [...current.loadedGames, gameType],
    }));
    image.src = GAME_BACKGROUNDS[gameType];
    return () => { image.onload = null; };
  }, [gameType, background.activeGame, background.loadedGames]);

  return <div className={styles.background} aria-hidden="true">
    {GAME_TYPES.map((type) => <div key={type} className={styles.layer}
      data-game-background={type} data-active={background.activeGame === type}
      style={{
        backgroundImage: background.loadedGames.includes(type) ? `url("${GAME_BACKGROUNDS[type]}")` : undefined,
        opacity: background.activeGame === type && background.loadedGames.includes(type) ? 1 : 0,
      }} />)}
  </div>;
}
