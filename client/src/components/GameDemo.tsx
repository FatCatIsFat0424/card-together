import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { GameType } from '@shared/types';
import { demoChapters, hasGameDemo } from '../game-demos';
import type { DemoGameType } from '../game-demos';
import { gameDemoTranslations } from '../game-demo-i18n';
import { useI18nStore } from '../stores/i18n-store';
import styles from './GameDemo.module.css';

function timeLabel(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

export function GameDemoPlayer({ gameType }: { readonly gameType: DemoGameType }): ReactNode {
  const { locale, t } = useI18nStore();
  const video = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [error, setError] = useState(false);
  const chapters = demoChapters(gameType);
  const copy = gameDemoTranslations[locale];
  const base = `${import.meta.env.BASE_URL}game-demos/${gameType}`;
  const current = chapters.findLast((chapter) => chapter.start <= currentTime)?.text;
  const seek = (seconds: number): void => {
    if (!video.current) return;
    video.current.currentTime = seconds;
    void video.current.play().catch(() => { /* Native controls remain available if playback is blocked. */ });
  };
  return <div className={styles.player}>
    <p className={styles.note}>{t('demo.description')}</p>
    <video ref={video} controls playsInline preload="none" src={`${base}.mp4`}
      aria-label={t('demo.videoLabel', { game: t(`gameType.${gameType}`) })}
      onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} onError={() => setError(true)}>
      <track kind="subtitles" src={`${base}.en.vtt`} srcLang="en" label="English" default={locale === 'en'} />
      <track kind="subtitles" src={`${base}.zh-TW.vtt`} srcLang="zh-TW" label="繁體中文" />
      <a href={`${base}.mp4`}>{t('demo.openVideo')}</a>
    </video>
    {error && <p role="alert">{t('demo.loadError')} <a href={`${base}.mp4`}>{t('demo.openVideo')}</a></p>}
    <ol className={styles.chapters} aria-label={t('demo.chapters')}>
      {chapters.map((chapter) => <li key={chapter.text}>
        <button type="button" className={styles.chapter} aria-current={current === chapter.text ? 'true' : undefined}
          onClick={() => seek(chapter.start)}>
          <time>{timeLabel(chapter.start)}</time><span>{copy[chapter.text].title}</span>
        </button>
      </li>)}
    </ol>
    <details className={styles.transcript}>
      <summary>{t('demo.transcript')}</summary>
      {chapters.map((chapter) => <section key={chapter.text}>
        <h4>{copy[chapter.text].title}</h4>
        <p>{copy[chapter.text].caption}</p>
        {copy[chapter.text].outcome && <p>{copy[chapter.text].outcome}</p>}
        {copy[chapter.text].rule && <p>{copy[chapter.text].rule}</p>}
      </section>)}
    </details>
  </div>;
}

export function GameDemo({ gameType }: { readonly gameType: GameType }): ReactNode {
  const { t } = useI18nStore();
  const [open, setOpen] = useState(false);
  if (!hasGameDemo(gameType)) return null;
  return <details className={styles.demo} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{t('demo.title')}</summary>
    {open && <GameDemoPlayer key={gameType} gameType={gameType} />}
  </details>;
}
