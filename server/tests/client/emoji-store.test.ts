import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmojiRecord } from '@shared/types';

const request = vi.hoisted(() => vi.fn());
vi.mock('../../../client/src/api', () => ({ apiRequest: request }));

import { useEmojiStore } from '../../../client/src/stores/emoji-store';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function emoji(accountId: string): EmojiRecord {
  return { id: accountId, accountId, name: 'wave', mediaId: `${'a'.repeat(64)}.png`, createdAt: 1 };
}

beforeEach(() => {
  request.mockReset();
  useEmojiStore.getState().reset();
});

describe('personal emoji loading', () => {
  it('deduplicates loading and ready requests', async () => {
    const pending = deferred<{ success: true; emojis: EmojiRecord[] }>();
    request.mockReturnValue(pending.promise);
    const loading = useEmojiStore.getState().load();
    await useEmojiStore.getState().load();
    expect(request).toHaveBeenCalledOnce();
    pending.resolve({ success: true, emojis: [emoji('alice')] });
    await loading;
    await useEmojiStore.getState().load();
    expect(request).toHaveBeenCalledOnce();
    expect(useEmojiStore.getState()).toMatchObject({ status: 'ready', emojis: [emoji('alice')] });
  });

  it('discards the old account response while a new account request is loading', async () => {
    const first = deferred<{ success: true; emojis: EmojiRecord[] }>();
    const second = deferred<{ success: true; emojis: EmojiRecord[] }>();
    request.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const oldLoading = useEmojiStore.getState().load();
    useEmojiStore.getState().reset();
    const newLoading = useEmojiStore.getState().load();
    first.resolve({ success: true, emojis: [emoji('alice')] });
    await oldLoading;
    expect(useEmojiStore.getState()).toMatchObject({ status: 'loading', emojis: [] });
    second.resolve({ success: true, emojis: [emoji('bob')] });
    await newLoading;
    expect(useEmojiStore.getState()).toMatchObject({ status: 'ready', emojis: [emoji('bob')] });
  });

  it('does not restore data after reset or overwrite a newer library', async () => {
    for (const replace of [false, true]) {
      const pending = deferred<{ success: true; emojis: EmojiRecord[] }>();
      request.mockReturnValueOnce(pending.promise);
      useEmojiStore.getState().reset();
      const loading = useEmojiStore.getState().load();
      if (replace) useEmojiStore.getState().setEmojis([emoji('new')]);
      else useEmojiStore.getState().reset();
      pending.resolve({ success: true, emojis: [emoji('old')] });
      await loading;
      expect(useEmojiStore.getState()).toMatchObject(replace
        ? { status: 'ready', emojis: [emoji('new')] } : { status: 'idle', emojis: [] });
    }
  });

  it('permits another request after an error', async () => {
    request.mockResolvedValueOnce({ success: false, error: 'Unavailable', status: 503 })
      .mockResolvedValueOnce({ success: true, emojis: [emoji('alice')] });
    await useEmojiStore.getState().load();
    expect(useEmojiStore.getState()).toMatchObject({ status: 'error', emojis: [] });
    await useEmojiStore.getState().load();
    expect(useEmojiStore.getState()).toMatchObject({ status: 'ready', emojis: [emoji('alice')] });
  });
});
