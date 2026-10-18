export const ANDROID_APP_URL = `${import.meta.env.BASE_URL}download/card-together.apk`;
export const ANDROID_APP_DISMISSED_PREFERENCE = 'androidAppDismissed';

/** Offer the APK only to Android browsers; the installed app runs in standalone display mode. */
export function shouldOfferAndroidApp(userAgent: string, standalone: boolean, dismissed: boolean): boolean {
  return /\bAndroid\b/i.test(userAgent) && !standalone && !dismissed;
}
