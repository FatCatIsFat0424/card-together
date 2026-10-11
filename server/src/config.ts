/**
 * Developer-only Sevens deal (`SEVENS_DEV_PRESET=near-slay`): every suit starts laid from 2 to Q so the first
 * plays close rows. Unset or empty means normal games; any other value, or any value in production, stops startup.
 */
export function parseSevensDevPreset(value: string | undefined, production: boolean): boolean {
  if (value === undefined || value === '') return false;
  if (value !== 'near-slay') throw new Error('SEVENS_DEV_PRESET must be near-slay or unset.');
  if (production) throw new Error('SEVENS_DEV_PRESET is for development only; unset it in production.');
  return true;
}

/** Parses comma-separated browser origins, rejecting paths, credentials, and non-HTTP schemes. */
export function parseAllowedOrigins(value: string): string[] {
  const origins = value.split(',').map((origin) => origin.trim()).filter(Boolean);
  if (origins.length === 0) throw new Error('CLIENT_ORIGIN must list at least one origin.');
  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`CLIENT_ORIGIN entry "${origin}" is not a valid URL.`);
    }
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.origin !== origin) {
      throw new Error(`CLIENT_ORIGIN entry "${origin}" must be an origin such as https://example.com.`);
    }
  }
  return origins;
}
