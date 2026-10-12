# Music, images, and voice

## Background music

Only the site owner supplies playlist files; players cannot upload music or enter URLs.

| Playback | Behavior |
| --- | --- |
| Controls | Play/pause, previous/next, repeat-one, sequential/shuffle, volume |
| Navigation | Native playback survives route changes and closing controls; pause keeps position |
| Reload | Starts stopped |
| Preferences | Volume defaults to 25%; volume/track/mode stay local and tolerate unavailable browser storage |

Place sources in ignored `local-music/` at the repository root:

```sh
npm run music:import
```

Client `predev` and `prebuild` import automatically, including workspace commands.
During development, rerun import and refresh after changes; there is no watcher.

| Import rule | Details |
| --- | --- |
| Formats | MP3, OGG, WAV, M4A, AAC, FLAC; recursive, case-insensitive |
| Titles/order | Filename without extension; natural relative-path order. Prefix numbers to choose order |
| Identity/cache | Relative paths give stable track IDs; moves/renames change identity. Content-hashed filenames invalidate replaced-byte caches |
| Audio | Copies original bytes without transcoding or level changes; browser codec support varies (MP3 is broadly supported) |
| Validation | Checks structure, paths, and nonempty files, not audio decodability |
| Safety | Rejects symlinks/empty audio before replacing the catalog; ignores unsupported files; removes only stale importer-owned output |

- Generated files: `client/src/audio/provided-music.generated.json` and
  `client/public/provided-music/imported-*`. **Do not edit them.** Sources and outputs
  are Git-ignored; a fresh checkout has an empty playlist.
- Build with the desired sources, then [publish the frontend](deployment.md#frontend-only-publication)
  and reload. Import alone does not update deployment.
- Instrument/sample libraries, composition catalogs, audition pages, and rendering
  tools live in `~/daw-tmp`; the game does not depend on them.
- Turn reminders are separate synthesized chimes, enabled by default. Music pause/volume
  does not disable them; they wait for the authoritative presentation deadline.
- A browser gesture (including click/touchend on iOS) unlocks audio. Blocked/obsolete
  reminders are not queued. Music reuses one audio element to preserve unlock across tracks.

## Images and chat

### Uploads and personal appearance

Account settings support avatars, table backgrounds, card backs, and a shared custom emoji library.

| Upload property | Rule |
| --- | --- |
| Formats | PNG, JPEG, GIF, WebP |
| Decoded size | Avatars/card backs: 512 KiB; emoji/backgrounds: 2 MiB |
| Request size | Proxy/server accept 3 MiB JSON, enough for a base64-encoded 2 MiB image |
| Storage | SHA-256 content-addressed IDs; immutable controlled reads |
| Quota | Per account; see [API](api.md) for limits/accounting. Large animated emoji can exhaust it before the 300-entry cap |
| GIF | Original bytes/animation retained for avatars, seat/table backgrounds, and card backs; same per-purpose byte limits |
| Static resize | Account page resizes backgrounds to a 1920-pixel long edge and card backs to 512 pixels; WebP with JPEG fallback |

- Table backgrounds/card backs are owner-only display settings: no broadcast or game-state change.
- A custom card back covers every face-down card (centered/cropped); otherwise the theme's
  default back is used.
- Image opacity is 20–100% (default 100%). It fades only the image toward a plain base:
  the theme's solid table surface or card face color, never its default pattern.
- Opacity saves after a short pause or on slider release.

### Account editor and history

| Account editor | Behavior |
| --- | --- |
| Preview | Identity and table appearance controls share one live table preview; stacks above controls on small screens |
| Immediate preview | Nickname, avatar preset, color, opacity |
| Saving | Nickname/avatar preset/color use **Save changes**; uploaded images appear after saving; image settings save automatically |
| Tabs | Profile; History (matches/visibility); Emoji (library); Password (password/sign-out) |
| Tab switching | Preserves unsaved profile edits |

History and statistics cover all eligible records loaded from the [history API](api.md#http).

- Table columns: date, room, game, result, players. It scrolls within its container on small screens.
- Search, game/result filters, and column sorting run locally; they do not change the API or records.
- Search matches room codes, player nicknames/usernames, game names, and result labels.
- Results follow the viewed account, including Bridge partnerships and tied winners.
- Reset restores all loaded records and newest-first order. Game/result filters use MUI
  outlined selects styled with existing theme variables.

| Statistics | Meaning |
| --- | --- |
| Per-game summary | Loaded match count and win rate for each supported game; MUI X horizontal comparison chart on larger screens |
| Overall donut | Each game's share of loaded matches; total in center; legend includes games with no matches |
| Win rate | Wins / matches played; ties counted separately; unplayed games have no percentage; Bridge wins follow partnerships |
| Filters/privacy | Independent of search/filters; private or unavailable public history reveals no statistics |
| Public profile | Same page width as account editor; avatar, colored nickname, username, actions on left; available history/statistics on right; stacks on small screens |

### Personal emoji library

| Rule | Details |
| --- | --- |
| Names | 2–64 ASCII letters/digits/`_`/`-`/`.`; start with letter, digit, or `_`. See `EMOJI_NAME_PATTERN` in [shared constants](../shared/src/constants/emoji.ts) |
| Case/compatibility | Case-sensitive (`Cat` and `cat` differ); earlier lowercase 2–32 names remain valid |
| Limits | 300 entries per account; API imports up to 50 per batch |
| Static imports | Resize to a 128-pixel long edge; WebP with PNG fallback |
| GIF imports | Original bytes; at most 2 MiB |
| Name normalization | Keep valid filenames; otherwise replace invalid characters with `_`, collapse repeats, strip leading separators/trailing `_`; use `emoji` if too little remains. Duplicates get `_2`, `_3`, etc. |

- File/folder pickers, dropped images/folders, and pasted images (while the library has
  focus) share the import pipeline.
- A name filter narrows the grid. Select mode adds checkboxes; shift-click selects a range.
- Select all uses the filtered list; one confirmation deletes the visible selection in
  one request. Deleting entries does not delete uploaded images.
- Stickers reuse the assets and may look softer at their larger display size.

### Room chat

- Text is trimmed to 1–500 characters. `:name:` resolves from the sender's library,
  then [site emoji](#site-provided-emoji), with at most 20 resolved names total.
- A standalone sticker uses an owned sticker ID or provided emoji name; clients cannot
  choose arbitrary URLs or another account's image.
- Sticker sends preserve text drafts and prevent duplicate pending sends.
- Ordinary text stays text; missing assets show unavailable labels.
- Chat works independently of voice settings. See [API](api.md) for payloads.

## Site-provided emoji

The owner can supply emoji for all accounts, as `:name:` text or stickers.
The picker lists them after the personal library.

- Personal emoji win same-name text matches; the picker hides shadowed site emoji
  while inserting. Both remain available as stickers.
- Place images in ignored `local-emoji/` at the repository root; subfolders are allowed:

```sh
npm run emoji:import
```

Client `predev`/`prebuild` run this after music import. A missing/empty folder produces
an empty catalog: no site picker section, successful build.

| Import rule | Details |
| --- | --- |
| Formats | PNG/JPEG/GIF/WebP (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, case-insensitive); other files ignored; output type follows magic bytes |
| Invalid files | Skip unreadable files or content outside these image formats |
| Names | Filename without extension, using personal name rules. Invalid names are normalized like UI imports, capped at 64 characters; fewer than 2 characters becomes `emoji_<6 hex of the path hash>` |
| Uniqueness | Case-sensitive across subfolders/extensions; valid original names keep priority in sorted path order; duplicates get `_2`, `_3`, etc. in sorted path order |
| Up to 2 MiB | Published unchanged (the personal emoji upload limit) |
| Over 2 MiB | Build-time `sharp` compresses to WebP at a maximum 256-pixel long edge, never enlarging; animated WebP retains every frame/timing. Retry smaller sizes/lower quality down to 96 pixels; skip if still too large |
| Safety | Symlinks fail import before replacement; remove only stale importer-owned output |
| Cache/history | `<name>-<content hash>.<type>` gives new URLs for changed bytes. History keeps the original file; removed/replaced images remain during the asset grace period, then show unavailable labels |

The import reports compressed sizes and renamed/skipped warnings; fix sources and rerun as needed.

| Generated catalog | Use |
| --- | --- |
| `shared/src/provided-emoji.generated.json` | Bundled by the client; read by the server at startup, accepting only listed names |
| `client/public/provided-emoji/<name>-*` | Published images |

- **Do not edit generated files.** Sources and outputs are Git-ignored.
- Missing server catalog means no site emoji; an invalid catalog stops startup.
- Restart the development server after import.
- In production, use the [full deployment](deployment.md#build-and-deploy), so the backend
  reloads the catalog; the frontend-only publisher is insufficient.

## Voice

| User action | Behavior |
| --- | --- |
| Join | Explicitly join room voice and grant microphone permission |
| Mute/deafen | Mute stops local transmission; deafen stops remote playback independently of music |
| Controls | Per-player volume/listening; available input/output device selection |
| Navigation | Follows membership across room/game/profile pages |
| Leave/logout/disconnect/removal | Releases microphone/peer resources |
| Refresh/tabs | Explicit rejoin required; only one tab per account can join |

- WebRTC sends peer-to-peer audio among up to twelve members (the room limit).
  During matches, participating players mute observers on their own side; see
  [spectators](games.md#spectators-and-god-view).
- Socket.IO relays only validated session/room/peer-bound signaling. **Voice is never
  recorded or saved.**
- Microphone access needs HTTPS or localhost. Permissions, autoplay, or unavailable
  devices may prevent audio despite connected transport.

Default ICE is `stun:stun.l.google.com:19302`. Restrictive NAT/firewalls need an operated
TURN relay. Set `VITE_WEBRTC_ICE_SERVERS` in `client/.env.local`, then rebuild/redeploy:

```dotenv
VITE_WEBRTC_ICE_SERVERS=[{"urls":"stun:stun.example.com:3478"},{"urls":"turn:turn.example.com:3478","username":"browser-user","credential":"browser-credential"}]
```

- This is **public configuration**: use browser-appropriate short-lived/restricted TURN
  credentials, never private app keys.
- Maximum eight servers/sixteen URLs; schemes: `stun:`, `stuns:`, `turn:`, `turns:`.
  Invalid configuration surfaces an error.
- Synthetic local-stream tests do not verify real microphones or cross-network routing.

| Connection handling | Behavior |
| --- | --- |
| Join identity | Fresh peer ID each cycle; stale signaling cannot attach to a new call |
| Errors/rejoin | Peer errors stay independent; rejoin replaces failed links and preserves preferences |
| Duplicate tab | Refresh may retry expired membership for up to 45 seconds without seizing another active tab |
| Bounds | Peer waits, SDP/candidate sizes, and signaling queues are bounded; failed links release resources while other calls remain |
