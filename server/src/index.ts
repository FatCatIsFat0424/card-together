import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isIP } from 'node:net';
import { openRepository } from './database/open-repository';
import { createApplication } from './app';
import { parseAllowedOrigins, parseBotWorkerConfig, parseDatabaseConfig, parseSevensDevPreset } from './config';
import { PROVIDED_EMOJI_CATALOG_PATH, loadProvidedEmojiCatalog } from './media/provided-emoji';

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST;
const trustProxyLoopback = process.env.TRUST_PROXY_LOOPBACK ?? 'false';
const clientOrigins = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173';

async function main(): Promise<void> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  if (host !== undefined && isIP(host) === 0) {
    throw new Error('HOST must be a valid IPv4 or IPv6 address.');
  }
  if (trustProxyLoopback !== 'true' && trustProxyLoopback !== 'false') {
    throw new Error('TRUST_PROXY_LOOPBACK must be true or false.');
  }
  if (process.env.NODE_ENV === 'production' && !process.env.CLIENT_ORIGIN) {
    throw new Error('Set CLIENT_ORIGIN to the public application origin in production.');
  }
  const database = parseDatabaseConfig(process.env.DATABASE_ENGINE, process.env.DATABASE_PATH,
    fileURLToPath(new URL('../data', import.meta.url)));
  const allowedOrigins = parseAllowedOrigins(clientOrigins);
  const sevensDevPreset = parseSevensDevPreset(process.env.SEVENS_DEV_PRESET, process.env.NODE_ENV === 'production');
  if (sevensDevPreset) console.warn('[server] SEVENS_DEV_PRESET=near-slay: Sevens games start with 2-Q laid out.');
  const botWorkers = parseBotWorkerConfig(process.env.BOT_WORKERS, process.env.BOT_WORKER_MEMORY_MB, process.env.BOT_SEARCH_QUEUE);
  const providedEmojis = await loadProvidedEmojiCatalog(PROVIDED_EMOJI_CATALOG_PATH);
  const repository = await openRepository(database);
  let application: Awaited<ReturnType<typeof createApplication>>;
  try {
    application = await createApplication(repository, {
      allowedOrigins, secureCookies: process.env.NODE_ENV === 'production',
      trustProxyLoopback: trustProxyLoopback === 'true',
      mediaDirectory: join(dirname(database.path), 'media'),
      providedEmojis,
      sevensDevPreset,
      botWorkers,
      listen: { port, host },
    });
  } catch (error) {
    await repository.close();
    throw error;
  }
  application.httpServer.on('error', (error) => console.error('[server] HTTP server error:', error));
  console.warn(`[server] Card Together listening on port ${port}`);
  let stopping = false;
  const shutdown = (): void => {
    if (stopping) return;
    stopping = true;
    void application.close().then(() => process.exit(0)).catch((error: unknown) => {
      console.error('[server] Shutdown failed:', error);
      process.exit(1);
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

void main().catch((error: unknown) => {
  console.error('[server] Startup failed:', error);
  process.exitCode = 1;
});
