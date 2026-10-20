import { defineConfig, loadEnv } from 'vite';
import type { ConfigEnv, UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { svgLayersPlugin } from '../scripts/assets/vite-svg-layers.ts';

export default defineConfig(({ mode }: ConfigEnv): UserConfig => {
  const environment = loadEnv(mode, process.cwd(), 'VITE_');
  const basePath = environment.VITE_BASE_PATH ?? '/';
  const proxyTarget = environment.VITE_DEV_PROXY_TARGET ?? 'http://localhost:3001';
  let proxyUrl: URL;
  try {
    proxyUrl = new URL(proxyTarget);
  } catch {
    throw new Error('VITE_DEV_PROXY_TARGET must be an HTTP(S) origin.');
  }
  if (
    !['http:', 'https:'].includes(proxyUrl.protocol) ||
    proxyUrl.username || proxyUrl.password ||
    proxyUrl.pathname !== '/' || proxyUrl.search || proxyUrl.hash
  ) {
    throw new Error('VITE_DEV_PROXY_TARGET must be an HTTP(S) origin without credentials or a path.');
  }
  if (
    !/^\/(?:[A-Za-z0-9._~-]+\/)*$/.test(basePath) ||
    basePath.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    throw new Error(
      'VITE_BASE_PATH must be an absolute URL path ending with /, such as /card-together/.',
    );
  }
  const rewriteProxyPath = (requestPath: string): string => requestPath.slice(basePath.length - 1);

  return {
    base: basePath,
    plugins: [react(), svgLayersPlugin()],
    resolve: {
      alias: {
        '@shared': path.resolve(__dirname, '../shared/src'),
      },
    },
    server: {
      port: 5173,
      proxy: {
        [`${basePath}api`]: {
          target: proxyUrl.origin,
          rewrite: rewriteProxyPath,
        },
        [`${basePath}socket.io`]: {
          target: proxyUrl.origin,
          ws: true,
          rewrite: rewriteProxyPath,
        },
      },
    },
  };
});
