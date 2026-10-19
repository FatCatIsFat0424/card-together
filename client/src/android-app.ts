export const ANDROID_APP_URL = `${import.meta.env.BASE_URL}download/card-together.apk`;
export const ANDROID_APP_DISMISSED_PREFERENCE = 'androidAppDismissed';

/** Offer the APK only to Android browsers outside the installed app. */
export function shouldOfferAndroidApp(userAgent: string, installed: boolean, dismissed: boolean): boolean {
  return /\bAndroid\b/i.test(userAgent) && !installed && !dismissed;
}
