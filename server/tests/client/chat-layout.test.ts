import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CLIENT = join(__dirname, '../../../client/src');
const chat = readFileSync(join(CLIENT, 'components/ChatPanel.module.css'), 'utf8');
const shopSticker = readFileSync(join(CLIENT, 'components/ShopSticker.module.css'), 'utf8');

describe('chat layout styles', () => {
  it('gives the native DM input the remaining row width while keeping the send button visible', () => {
    const input = chat.match(/\.chatInput \{([^}]+)\}/)?.[1] ?? '';
    expect(input).toMatch(/flex: 1;/);
    expect(input).toMatch(/min-width: 0;/);
    expect(input).toMatch(/color: var\(--text-primary\);/);
    expect(chat).toMatch(/\.chatSendBtn \{[^}]*flex-shrink: 0;/);
    expect(chat).toMatch(/@media \(max-width: 767px\) \{ \.composer, \.chatInput \{ font-size: 16px;/);
    const direct = readFileSync(join(CLIENT, 'components/DirectMessages.module.css'), 'utf8');
    expect(direct).toMatch(/\.composer form button\[type='submit'\] \{ color: var\(--color-primary\);/);
    expect(direct).toMatch(/\.composer form button\[type='submit'\]:hover:not\(:disabled\) \{ background: var\(--color-primary-soft\);/);
  });

  it('caps all message stickers at 112px and 96px on phones without changing thumbnails or inline emoji', () => {
    expect(chat).toMatch(/\.stickerImage \{\s*--sticker-size: 112px;/);
    expect(chat).toMatch(/@media \(max-width: 767px\) \{ \.stickerImage \{ --sticker-size: 96px;/);
    expect(chat).toMatch(/\.stickerImage img \{[^}]*object-fit: contain;/);
    expect(shopSticker).toMatch(/\.sticker \{[^}]*width: 112px;[^}]*height: 112px;[^}]*object-fit: contain;/);
    expect(shopSticker).toMatch(/@media \(max-width: 767px\) \{ \.sticker \{ width: 96px; height: 96px;/);
    expect(shopSticker).toMatch(/\.small \{ width: 64px; height: 64px;/);
    expect(chat).toMatch(/\.stickerImage\.smallImage \{ --sticker-size: 28px;/);
    expect(chat).toMatch(/\.pickerItem \.smallImage \{ --sticker-size: 34px;/);
    expect(chat).toMatch(/\.emoji \{[^}]*height: 1\.6em;[^}]*width: auto;/);
  });

  it('never adds floating room card clearance to routed pages or global styles', () => {
    const pages = join(CLIENT, 'pages');
    const paths = readdirSync(pages).filter((name) => name.endsWith('.css')).map((name) => join(pages, name));
    paths.push(join(CLIENT, 'styles/global.css'));
    for (const path of paths) expect(readFileSync(path, 'utf8'), path).not.toContain('--room-card-clearance');
  });

  it('retains ordinary page insets and the bottom safe area for full-height messages and the lobby', () => {
    for (const page of ['MessagesPage', 'LobbyPage', 'DesktopLobby']) {
      const css = readFileSync(join(CLIENT, `pages/${page}.module.css`), 'utf8');
      expect(css).toContain('max(var(--page-inset), env(safe-area-inset-bottom))');
    }
    const messages = readFileSync(join(CLIENT, 'pages/MessagesPage.module.css'), 'utf8');
    expect(messages).toMatch(/\.page \{[^}]*height: 100%;[^}]*min-height: 0;/);
    expect(messages).toContain('padding: 0 0 env(safe-area-inset-bottom);');
  });
});
