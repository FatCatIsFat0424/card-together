import { useState } from 'react';
import type { ReactNode } from 'react';
import useMediaQuery from '@mui/material/useMediaQuery';
import { ANDROID_APP_DISMISSED_PREFERENCE, ANDROID_APP_URL, shouldOfferAndroidApp } from '../android-app';
import { useI18nStore } from '../stores/i18n-store';
import { readPreference, writePreference } from '../utils/preference-storage';
import { AppIcon } from './AppIcon';
import styles from './AndroidAppBanner.module.css';

export function AndroidAppBanner(): ReactNode {
  const { t } = useI18nStore();
  const standalone = useMediaQuery('(display-mode: standalone)');
  const [dismissed, setDismissed] = useState(() => readPreference(ANDROID_APP_DISMISSED_PREFERENCE) === 'true');
  if (!shouldOfferAndroidApp(navigator.userAgent, standalone, dismissed)) return null;
  const dismiss = (): void => {
    writePreference(ANDROID_APP_DISMISSED_PREFERENCE, 'true');
    setDismissed(true);
  };
  return <section className={styles.banner} aria-labelledby="android-app-title">
    <AppIcon name="android" className={styles.icon} />
    <div className={styles.text}>
      <h2 id="android-app-title">{t('lobby.androidAppTitle')}</h2>
      <p>{t('lobby.androidAppDescription')}</p>
    </div>
    <a className={`btn btn-primary ${styles.download}`} href={ANDROID_APP_URL} download="card-together.apk">
      {t('lobby.androidAppDownload')}</a>
    <button type="button" className={`btn btn-secondary ${styles.dismiss}`} onClick={dismiss}
      aria-label={t('lobby.androidAppDismiss')}><AppIcon name="close" /></button>
  </section>;
}
