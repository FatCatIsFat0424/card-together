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
