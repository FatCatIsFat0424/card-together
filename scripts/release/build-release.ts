import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEnvironment, validateArtifacts } from '../validation/artifacts';
import { RELEASE_DIRECTORY, assembleRelease } from './assemble';

const root = fileURLToPath(new URL('../..', import.meta.url));

// The application is served below /card-together/ with the API on the same origin.
const CLIENT_ENVIRONMENT: Readonly<Record<string, string>> = {
  VITE_BASE_PATH: '/card-together/', VITE_SERVER_URL: '', VITE_SOCKET_PATH: '/card-together/socket.io',
};

function run(label: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  process.stdout.write(`Release: ${label}\n`);
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolveRun(); else reject(new Error(`${label} failed (${signal ?? `exit ${code}`}).`));
    });
  });
}

async function main(): Promise<void> {
  // The bundle and the artifact check read the same process environment.
  for (const [name, value] of Object.entries(CLIENT_ENVIRONMENT)) process.env[name] ??= value;
  const environment = process.env;
  // Importers read LCM_INPUTS_DIR themselves and fall back to local-music, local-emoji and local-demos.
  for (const [label, script] of [['import music', 'audio/import-provided-music.mjs'], ['import emoji', 'emoji/import-provided-emoji.mjs'],
    ['import demos', 'demos/import-demo-videos.mjs']] as const) {
    await run(label, [join(root, 'scripts', script)], root, environment);
  }
  const client = join(root, 'client');
  await run('client typecheck', [join(root, 'node_modules/typescript/bin/tsc'), '-b'], client, environment);
  await run('client bundle', [join(root, 'node_modules/vite/bin/vite.js'), 'build'], client, environment);
  const build = buildEnvironment(root, true);
  process.stdout.write(`Release: artifacts ${JSON.stringify(await validateArtifacts(root, build.base))}\n`);
  const { links } = await assembleRelease(root, join(root, RELEASE_DIRECTORY));
  process.stdout.write(`Release: assembled ${RELEASE_DIRECTORY}/ (${links} relative links)\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Release build failed.');
  process.exitCode = 1;
});
