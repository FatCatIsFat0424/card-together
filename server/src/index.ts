import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { isIP } from 'node:net';
import { createJsonRepository } from './database/json-repository';
import { createApplication } from './app';

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST;
const trustProxyLoopback = process.env.TRUST_PROXY_LOOPBACK ?? 'false';
const databasePath = process.env.DATABASE_PATH
  ? resolve(process.env.DATABASE_PATH)
  : fileURLToPath(new URL('../data/database.json', import.meta.url));
const allowedOrigins = (process.env.CLIENT_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',').map((origin) => origin.trim()).filter(Boolean);

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
  const repository = await createJsonRepository(databasePath);
  const application = await createApplication(repository, {
    allowedOrigins, secureCookies: process.env.NODE_ENV === 'production',
    trustProxyLoopback: trustProxyLoopback === 'true',
    mediaDirectory: join(dirname(databasePath), 'media'),
  });
  application.httpServer.listen(port, host, () => {
    console.warn(`[server] Card Together listening on port ${port}`);
  });
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
