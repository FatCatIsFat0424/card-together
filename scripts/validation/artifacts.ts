import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadEnv } from 'vite';
import { parseProvidedEmojiCatalog } from '../../shared/src/constants/emoji';
import { validateProvidedMusicCatalog } from '../../client/src/audio/validate-provided-music-catalog';
import type { ProvidedMusicTrack } from '../../client/src/audio/validate-provided-music-catalog';

export interface BuildEnvironment {
  base: string;
  socketPath: string;
  serverUrl: string;
}

export function buildEnvironment(root: string, release: boolean): BuildEnvironment {
  const environment = loadEnv('production', join(root, 'client'), 'VITE_');
  const base = environment.VITE_BASE_PATH ?? '/';
  if (!/^\/(?:[A-Za-z0-9._~-]+\/)*$/.test(base) || base.split('/').some((part) => part === '.' || part === '..')) {
    throw new Error('VITE_BASE_PATH must be an absolute path ending with / without traversal.');
  }
  const socketPath = environment.VITE_SOCKET_PATH ?? `${base}socket.io`;
  const serverUrl = environment.VITE_SERVER_URL ?? '';
  if (release && (!environment.VITE_BASE_PATH || !environment.VITE_SOCKET_PATH)) {
    throw new Error('Release validation requires explicit VITE_BASE_PATH and VITE_SOCKET_PATH.');
  }
  if (release && socketPath !== `${base}socket.io`) throw new Error('Release Socket path must match the configured application base.');
  if (serverUrl && !/^https?:\/\//.test(serverUrl)) throw new Error('VITE_SERVER_URL must be an HTTP(S) URL or empty.');
  return { base, socketPath, serverUrl };
}

async function regularFile(root: string, path: string): Promise<Buffer> {
  const parts = path.split('/');
  for (let index = 1; index <= parts.length; index += 1) {
    const info = await lstat(join(root, ...parts.slice(0, index)));
    if (info.isSymbolicLink() || (index === parts.length ? !info.isFile() : !info.isDirectory())) {
      throw new Error(`Artifact path is not a regular in-root file: ${path}`);
    }
  }
  return readFile(join(root, path));
}

function parseMusic(value: unknown): ProvidedMusicTrack[] {
  if (!Array.isArray(value)) throw new Error('Provided music catalog must be an array.');
  const tracks = value.map((item: unknown): ProvidedMusicTrack => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid provided music record.');
    const record = item as Record<string, unknown>;
    const hasGroup = 'group' in record;
    if (Object.keys(record).length !== (hasGroup ? 4 : 3) || typeof record.id !== 'string' ||
      typeof record.title !== 'string' || typeof record.file !== 'string' ||
      (hasGroup && typeof record.group !== 'string')) throw new Error('Invalid provided music record.');
    const track = { id: record.id, title: record.title, file: record.file };
    return typeof record.group === 'string' ? { ...track, group: record.group } : track;
  });
  validateProvidedMusicCatalog(tracks);
  return tracks;
}

export async function validateArtifacts(root: string, base: string): Promise<{ assets: number; music: number; emoji: number }> {
  const html = (await regularFile(root, 'client/dist/index.html')).toString('utf8');
  const urls = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map((match) => match[1]);
  const localUrls = urls.filter((url) => !/^(?:https?:|data:|#)/.test(url));
  if (!localUrls.some((url) => url.startsWith(`${base}assets/`) && url.endsWith('.js'))) {
    throw new Error('Production index must reference a JavaScript asset under the configured base.');
  }
  for (const url of localUrls) {
    if (!url.startsWith(base)) throw new Error(`Asset URL does not match configured base: ${url}`);
    const path = decodeURIComponent(url.slice(base.length).split(/[?#]/)[0]);
    if (!path || path.split('/').some((part) => !part || part === '..' || part === '.') || path.includes('\\')) {
      throw new Error('Artifact URL contains an invalid local path.');
    }
    await regularFile(root, `client/dist/${path}`);
  }
  const musicValue: unknown = JSON.parse((await regularFile(root, 'client/src/audio/provided-music.generated.json')).toString('utf8'));
  const emojiValue: unknown = JSON.parse((await regularFile(root, 'shared/src/provided-emoji.generated.json')).toString('utf8'));
  const music = parseMusic(musicValue);
  const emoji = parseProvidedEmojiCatalog(emojiValue);
  for (const [directory, records] of [['provided-music', music], ['provided-emoji', emoji]] as const) {
    for (const { file } of records) {
      const source = await regularFile(root, `client/public/${directory}/${file}`);
      const built = await regularFile(root, `client/dist/${directory}/${file}`);
      if (!source.equals(built)) throw new Error(`Built asset differs from imported asset: ${directory}/${file}`);
      const digest = createHash('sha256').update(source).digest('hex').slice(0, 24);
      if (!file.endsWith(`-${digest}.${file.split('.').at(-1)}`)) throw new Error(`Asset filename content hash mismatch: ${file}`);
    }
  }
  return { assets: localUrls.length, music: music.length, emoji: emoji.length };
}
