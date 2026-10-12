import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import Dialog from '@mui/material/Dialog';
import type { RoomInfo } from '@shared/types';
import { GAME_SEAT_ORDER } from '@shared/constants';
import { roomSeatInfo } from '@shared/rules/seats';
import { useRoomStore } from '../stores/room-store';
import { useAccountStore } from '../stores/account-store';
import { useI18nStore } from '../stores/i18n-store';
import { useMotionStore } from '../stores/motion-store';
import { useTurnSoundStore } from '../stores/turn-sound-store';
import { AUDIO_UNLOCK_EVENTS } from '../audio/audio-unlock';
import { disposeCardSounds, playStartSound, unlockCardSounds } from '../audio/card-sound';
import { GAME_BACKGROUNDS } from '../game-backgrounds';
import { scheduleGameIntro, shouldStartGameIntro } from '../games/game-intro';
import type { IntroStage } from '../games/game-intro';
import { Avatar } from './Avatar';
import styles from './GameStartTransition.module.css';

interface Intro { readonly room: RoomInfo; readonly startedAt: number }

function IntroScreen({ intro, finish }: { readonly intro: Intro; readonly finish: () => void }): ReactNode {
  const { t } = useI18nStore();
  const reduced = useMotionStore((state) => state.reducedMotion);
  const [stage, setStage] = useState<IntroStage>('title');
  const players = GAME_SEAT_ORDER.flatMap((seat) => {
    const player = roomSeatInfo(intro.room, seat)?.player;
    return player ? [player] : [];
  });
  useEffect(() => scheduleGameIntro(intro.startedAt, reduced, {
    stage: setStage, finish,
    impact: () => {
      if (document.visibilityState === 'visible' && useTurnSoundStore.getState().enabled) playStartSound();
    },
  }), [intro.startedAt, reduced, finish]);
  useEffect(() => {
    const hide = (): void => { if (document.visibilityState !== 'visible') finish(); };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, [finish]);

  return <Dialog open fullScreen transitionDuration={0} onClose={finish} aria-labelledby="game-intro-title"
    slotProps={{ paper: { className: styles.screen } }}>
    <div className={styles.scene} data-stage={stage} data-reduced={reduced}>
      <div className={styles.background} style={{ backgroundImage: `url("${GAME_BACKGROUNDS[intro.room.gameType]}")` }} />
      <div className={styles.shade} />
      <h1 id="game-intro-title" className={styles.title}>{t(`gameType.${intro.room.gameType}`)}</h1>
      <ul className={styles.players} aria-hidden={stage === 'title'} data-count={players.length}>
        {players.map((player) => <li key={player.id} className={styles.player}>
          <div className={styles.avatar}><Avatar avatar={player.avatar} image={player.avatarImage}
            border={player.avatarBorder} color={player.color} size="large" /></div>
          <span className={styles.name}>{player.nickname}</span>
        </li>)}
      </ul>
      <button type="button" className={styles.skip} onClick={finish} autoFocus>{t('intro.skip')}</button>
    </div>
  </Dialog>;
}

export function GameStartTransition(): ReactNode {
  const { pathname } = useLocation();
  const [intro, setIntro] = useState<Intro | null>(null);
  const finish = useCallback(() => setIntro(null), []);
  useEffect(() => {
    const unlock = (event: Event): void => { if (event.isTrusted) unlockCardSounds(); };
    AUDIO_UNLOCK_EVENTS.forEach((event) => window.addEventListener(event, unlock));
    return () => {
      AUDIO_UNLOCK_EVENTS.forEach((event) => window.removeEventListener(event, unlock));
      disposeCardSounds();
    };
  }, []);
  useEffect(() => useRoomStore.subscribe((next, previous) => {
    if (next.roomInfo && shouldStartGameIntro(previous.roomInfo, next.roomInfo,
      useAccountStore.getState().connection === 'ready', document.visibilityState === 'visible', pathname)) {
      setIntro({ room: next.roomInfo, startedAt: Date.now() });
    } else if (!next.roomInfo || next.roomInfo.status !== 'playing'
      || next.currentRoomCode !== previous.currentRoomCode) finish();
  }), [pathname, finish]);
  if (!intro || (pathname !== `/room/${intro.room.code}` && pathname !== `/game/${intro.room.code}`)) return null;
  return <IntroScreen key={intro.startedAt} intro={intro} finish={finish} />;
}
