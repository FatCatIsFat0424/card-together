import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateArtifacts } from '../../../scripts/validation/artifacts';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function fixture(): Promise<{ root: string; file: string }> {
  const root = await mkdtemp(join(tmpdir(), 'card-artifact-')); directories.push(root);
  const bytes = Buffer.from('synthetic audio');
  const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 24);
  const file = `imported-${'a'.repeat(24)}-${digest}.mp3`;
  const files = {
    'client/dist/index.html': '<script src="/card-together/assets/entry.js"></script>',
    'client/dist/assets/entry.js': 'export {};',
    'client/src/audio/provided-music.generated.json': JSON.stringify([{ id: `provided-${'a'.repeat(24)}`, title: 'Fixture', file }]),
    'shared/src/provided-emoji.generated.json': '[]',
    [`client/public/provided-music/${file}`]: bytes,
    [`client/dist/provided-music/${file}`]: bytes,
  };
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), content);
  }
  return { root, file };
}

describe('real build artifact boundaries', () => {
  it('checks configured base, catalog acceptance and identical imported/built bytes', async () => {
    const { root } = await fixture();
    await expect(validateArtifacts(root, '/card-together/')).resolves.toEqual({ assets: 1, music: 1, emoji: 0 });
    await expect(validateArtifacts(root, '/')).rejects.toThrow();
  });

  it('rejects missing or corrupted built assets', async () => {
    const { root, file } = await fixture();
    await writeFile(join(root, 'client/dist/provided-music', file), 'corrupt');
    await expect(validateArtifacts(root, '/card-together/')).rejects.toThrow('differs');
    await rm(join(root, 'client/dist/assets/entry.js'));
    await expect(validateArtifacts(root, '/card-together/')).rejects.toThrow();
  });

  it('rejects catalog traversal and symlink output without reading external targets', async () => {
    const { root } = await fixture();
    await writeFile(join(root, 'shared/src/provided-emoji.generated.json'), '[{"name":"aa","file":"../../outside.gif"}]');
    await expect(validateArtifacts(root, '/card-together/')).rejects.toThrow('Invalid');
    await writeFile(join(root, 'shared/src/provided-emoji.generated.json'), '[]');
    await rm(join(root, 'client/dist/assets/entry.js'));
    await symlink(join(root, 'client/dist/index.html'), join(root, 'client/dist/assets/entry.js'));
    await expect(validateArtifacts(root, '/card-together/')).rejects.toThrow('regular');
  });
});
