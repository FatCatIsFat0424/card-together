import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEnv } from 'vite';
import type { UserConfig } from 'vite';
import viteConfig from '../../../client/vite.config';

vi.mock('vite', async (importOriginal) => {
  const original = await importOriginal<typeof import('vite')>();
  return { ...original, loadEnv: vi.fn() };
});

afterEach(() => { vi.resetAllMocks(); });

async function developmentConfig(environment: Record<string, string>): Promise<UserConfig> {
  vi.mocked(loadEnv).mockReturnValue(environment);
  if (typeof viteConfig !== 'function') throw new Error('Expected a Vite configuration factory.');
  return viteConfig({ command: 'serve', mode: 'development' });
}

describe('development backend proxy', () => {
  it('routes API and Socket.IO to a separate development backend', async () => {
    const config = await developmentConfig({ VITE_DEV_PROXY_TARGET: 'http://127.0.0.1:3002/' });
    expect(config.server?.proxy?.['/api']).toMatchObject({ target: 'http://127.0.0.1:3002' });
    expect(config.server?.proxy?.['/socket.io']).toMatchObject({ target: 'http://127.0.0.1:3002', ws: true });
  });

  it('preserves the existing default target and supports application base paths', async () => {
    const config = await developmentConfig({ VITE_BASE_PATH: '/card-together/' });
    expect(config.server?.proxy?.['/card-together/api']).toMatchObject({ target: 'http://localhost:3001' });
    expect(config.server?.proxy?.['/card-together/socket.io']).toMatchObject({ target: 'http://localhost:3001', ws: true });
  });

  it.each(['', 'localhost:3002', 'ftp://localhost:3002', 'http://user:password@localhost:3002',
    'http://localhost:3002/api', 'http://localhost:3002?target=other', 'http://localhost:3002#other'])(
    'rejects invalid or ambiguous proxy origins: %s', async (target) => {
      await expect(developmentConfig({ VITE_DEV_PROXY_TARGET: target })).rejects.toThrow('VITE_DEV_PROXY_TARGET');
    },
  );
});
