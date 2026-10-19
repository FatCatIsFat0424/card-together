import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { ANDROID_APP_URL, shouldOfferAndroidApp } from '../../../client/src/android-app';

const ROOT = path.resolve(__dirname, '../../..');
const readJson = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path.join(ROOT, file), 'utf8')) as Record<string, unknown>;

const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const desktop = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

describe('Android app offer', () => {
  it('offers the APK only in Android browsers that have not dismissed it', () => {
    expect(shouldOfferAndroidApp(android, false, false)).toBe(true);
    expect(shouldOfferAndroidApp(iphone, false, false)).toBe(false);
    expect(shouldOfferAndroidApp(desktop, false, false)).toBe(false);
    expect(shouldOfferAndroidApp(android, false, true)).toBe(false);
  });

  it('hides the offer inside the installed app', () => {
    expect(shouldOfferAndroidApp(android, true, false)).toBe(false);
  });

  it('downloads from the published client path', () => {
    expect(ANDROID_APP_URL).toMatch(/\/download\/card-together\.apk$/);
  });

  it('opens the APK full screen with system bars hidden until swiped in', () => {
    expect(readJson('android/twa-manifest.json').display).toBe('fullscreen-sticky');
  });

  it('opens in landscape both as the APK and as an installed web app', () => {
    expect(readJson('android/twa-manifest.json').orientation).toBe('landscape');
    expect(readJson('client/public/manifest.webmanifest').orientation).toBe('landscape');
  });
});
