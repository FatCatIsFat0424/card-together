import { describe, expect, it } from 'vitest';
import { ANDROID_APP_URL, shouldOfferAndroidApp } from '../../../client/src/android-app';

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
});
