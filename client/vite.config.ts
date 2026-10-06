import { defineConfig, loadEnv } from 'vite';
import type { ConfigEnv, UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }: ConfigEnv): UserConfig => {
  const environment = loadEnv(mode, process.cwd(), 'VITE_');
  const basePath = environment.VITE_BASE_PATH ?? '/';
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
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': path.resolve(__dirname, '../shared/src'),
      },
    },
    server: {
      port: 5173,
      proxy: {
        [`${basePath}api`]: {
          target: 'http://localhost:3001',
          rewrite: rewriteProxyPath,
        },
        [`${basePath}socket.io`]: {
          target: 'http://localhost:3001',
          ws: true,
          rewrite: rewriteProxyPath,
        },
      },
    },
  };
});
