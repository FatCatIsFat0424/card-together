import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { GameType } from '@shared/types';
import { isDemoGameType } from '../game-demos';
import { demoVideoFile } from '../game-demo-catalog';
import type { DemoGameType } from '../game-demos';
import type { Locale } from '../i18n';
import { useI18nStore } from '../stores/i18n-store';
import styles from './GameDemo.module.css';

const SUBTITLES: readonly { readonly locale: Locale; readonly label: string }[] = [
  { locale: 'zh-TW', label: '繁體中文' },
  { locale: 'en', label: 'English' },
];

/** Shows the subtitles of the interface language and hides the others. */
export function showSubtitles(tracks: Iterable<Pick<TextTrack, 'language' | 'mode'>>, locale: Locale): void {
  for (const track of tracks) track.mode = track.language === locale ? 'showing' : 'hidden';
}

export function GameDemoPlayer({ gameType, file }: { readonly gameType: DemoGameType; readonly file: string }): ReactNode {
  const { locale, t } = useI18nStore();
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState(false);
  const base = `${import.meta.env.BASE_URL}game-demos/${gameType}`;
  const source = `${import.meta.env.BASE_URL}game-demos/${file}`;
  // Browsers read `default` only while loading, so later language changes switch the tracks directly.
  useEffect(() => {
    if (video.current) showSubtitles(Array.from(video.current.textTracks), locale);
  }, [locale]);
  return <div className={styles.player}>
    <p className={styles.note}>{t('demo.description')}</p>
    <video ref={video} controls playsInline preload="none" src={source}
      aria-label={t('demo.videoLabel', { game: t(`gameType.${gameType}`) })} onError={() => setError(true)}>
      {SUBTITLES.map((subtitle) => <track key={subtitle.locale} kind="subtitles" src={`${base}.${subtitle.locale}.vtt`}
        srcLang={subtitle.locale} label={subtitle.label} default={subtitle.locale === locale} />)}
      <a href={source}>{t('demo.openVideo')}</a>
    </video>
    {error && <p role="alert">{t('demo.loadError')} <a href={source}>{t('demo.openVideo')}</a></p>}
  </div>;
}

export function GameDemo({ gameType }: { readonly gameType: GameType }): ReactNode {
  const { t } = useI18nStore();
  const [open, setOpen] = useState(false);
  const demoGame = isDemoGameType(gameType) ? gameType : null;
  const file = demoGame ? demoVideoFile(demoGame) : null;
  if (!demoGame || !file) return null;
  return <details className={styles.demo} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{t('demo.title')}</summary>
    {open && <GameDemoPlayer key={demoGame} gameType={demoGame} file={file} />}
  </details>;
}
