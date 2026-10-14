# Music, images, and voice

## Background music

Only the site owner supplies music; players cannot upload tracks or enter URLs.

1. Put audio files in the Git-ignored `local-music/` at the repository root.
2. Run `npm run music:import` (client `predev` and `prebuild` also run it). There is no
   watcher: rerun and refresh after changes.
3. To publish, build and use the [frontend publisher](deployment.md#frontend-only-publication).

| Import rule | Behavior |
| --- | --- |
| Formats | MP3, OGG, OPUS, WAV, M4A, AAC, FLAC; recursive, case-insensitive; other files ignored |
| Title and order | Filename without extension; root files first, then folders, each in natural path order; prefix numbers to set order |
| Groups | Each first-level folder is a player list section; deeper folders join it |
| Track ID | Relative path, so moves and renames change identity; hashed output names refresh caches |
| Audio | Original bytes, no transcoding; browser codec support varies (MP3 is safest) |
| Validation | Structure, paths, and nonempty files; not decodability |
| Safety | Symlinks or empty files fail before the catalog changes; only stale importer output is removed |

- Generated, Git-ignored, **do not edit:** `client/src/audio/provided-music.generated.json`
  and `client/public/provided-music/imported-*`. A fresh checkout has an empty playlist.
- Player controls: play/pause, previous/next, repeat-one, sequential or shuffle, volume
  (default 50%). New visitors start with shuffle and a random track; saved volume,
  track, mode, and group selection are restored locally.
- The current track shows its group before the title. Groups collapse (only the
  current one opens with the panel) and each has a checkbox: deselected groups are
  skipped by previous/next, shuffle, and auto-advance but stay playable by click. At
  least one playable group or root track always remains selected.
- Opening the site in a new tab starts playback. A reload keeps a pause made in that
  tab (session storage) until the player presses play again. If the browser blocks
  autoplay, playback waits for a trusted user gesture; pausing cancels this retry.
  Playback continues across routes and when the panel closes.
  One audio element is reused so the browser unlock carries across tracks.
- Turn reminders are separate synthesized chimes, on by default and unaffected by music
  pause or volume. They wait for the presentation deadline and are dropped, not queued,
  when audio is blocked.
- A user gesture (click, or touchend on iOS) unlocks audio.

## Uploads

Avatars, seat backgrounds, table backgrounds, card backs, and emoji are uploaded as images.

| Property | Rule |
| --- | --- |
| Formats | PNG, JPEG, GIF, WebP |
| Decoded size | Avatars and card backs 512 KiB; emoji and backgrounds 2 MiB |
| Request size | 3 MiB JSON body (proxy and server), enough for a base64 2 MiB image |
| Quota | 100 MiB of distinct images per account ([`MEDIA_QUOTA_BYTES`](../server/src/media/media-store.ts)). Re-uploading an owned image is free; replaced images still count |
| Storage | Immutable SHA-256 content-addressed IDs, read through the media endpoint |
| GIF | Original bytes and animation kept, within the same limits |
| Static resize (client) | Backgrounds to a 1920-pixel long edge, card backs to 512, emoji to 128; WebP with JPEG (PNG for emoji) fallback |

- Uploads check Origin, session, and rate limits before parsing the body. Errors: [API](api.md#status-codes).
- Table backgrounds and card backs are visible only to their owner and never broadcast.
- A custom card back covers every face-down card (centered and cropped).
- Image opacity is 20–100% (default 100%) and fades the image toward the theme's solid
  table or card color. It saves after a short pause or on slider release.

## Official cosmetic artwork

- The shop bundles original static SVG artwork under `client/src/assets/shop/`.
  Vite resolves asset URLs for the configured application base; these files are not
  uploaded media or site-emoji importer output and consume no upload quota.
- Official card backs, table backgrounds, and seat backgrounds take precedence over
  retained uploads only while equipped. Image opacity also applies to official table
  and card artwork. Unequip to restore the upload or theme; uploads remain free.
- Product ownership, equipment, and rollback rules:
  [storage](storage.md#cosmetic-inventory). Presentation: [interface](interface.md#cosmetic-shop).

## Personal emoji library

| Rule | Behavior |
| --- | --- |
| Names | 2–64 ASCII letters, digits, `_`, `-`, `.`; must start with a letter, digit, or `_` ([`EMOJI_NAME_PATTERN`](../shared/src/constants/emoji.ts)) |
| Case | Case-sensitive; older lowercase 2–32 character names stay valid |
| Limits | 300 entries per account, up to 50 per import; large animated emoji may hit the quota first |
| Import naming | Valid filenames are kept. Otherwise invalid characters become `_`, repeats collapse, leading separators and trailing `_` are stripped, and too-short names become `emoji`. Duplicates get `_2`, `_3`, … |

- File and folder pickers, drag and drop, and paste (while the library has focus) share
  one import pipeline.
- A name filter narrows the grid. Select mode adds checkboxes with Shift-click ranges;
  Select all uses the filtered list and one confirmation deletes the selection in one request.
- Deleting entries does not delete uploaded images.

## Room chat

- Text is trimmed to 1–500 characters. `:name:` resolves from the sender's library, then
  [site emoji](#site-provided-emoji), up to 20 names per message.
- A sticker message is one personal sticker ID, one site emoji name, or one official
  shop sticker ID. The server checks the sender owns a shop sticker's pack on each
  send; room chat and private messages use the same rule. Clients cannot send URLs
  or another account's image. Recipients need no purchase to see received stickers.
- Sending a sticker keeps the text draft and blocks duplicate pending sends. Missing
  images show an unavailable label.
- Personal and site stickers reuse emoji images and may look softer at their larger
  size. Shop stickers use bundled vector artwork and translated accessible names.
- Chat works regardless of voice. Payloads: [API](api.md#socket-actions); observer
  channels: [games](games.md#spectators-and-god-view).

## Site-provided emoji

Owner-supplied emoji available to every account as `:name:` text or stickers, in the
picker tab after the personal library. Personal emoji win same-name text matches (the
picker hides the shadowed site emoji); both remain usable as stickers.

1. Put images in the Git-ignored `local-emoji/` (subfolders allowed).
2. Run `npm run emoji:import` (also run by client `predev` and `prebuild`, after music).
   An empty or missing folder gives an empty catalog and a successful build.
3. Restart the development server. In production, run the
   [full deployment](deployment.md#build-and-deploy): the backend must reload the catalog,
   and the frontend publisher refuses a changed catalog.

| Import rule | Behavior |
| --- | --- |
| Formats | `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp` (case-insensitive); output type follows the file's magic bytes; other or unreadable files are skipped |
| Names | Filename without extension, normalized like personal imports and capped at 64 characters; under 2 characters becomes `emoji_<6 hex of path hash>` |
| Uniqueness | Case-sensitive across folders and extensions; valid original names win, then sorted path order assigns `_2`, `_3`, … |
| ≤ 2 MiB | Published unchanged |
| > 2 MiB | `sharp` compresses to WebP at up to 256 pixels (never enlarging), keeping every animation frame; retries smaller and lower quality down to 96 pixels, else skips |
| Output names | `<name>-<content hash>.<type>`, so changed bytes get new URLs |
| Safety | Symlinks fail before anything is replaced; only stale importer output is removed |

- The import prints compressed sizes and rename or skip warnings.
- Generated, Git-ignored, **do not edit:** `shared/src/provided-emoji.generated.json`
  (bundled by the client, read by the server at startup) and `client/public/provided-emoji/`.
- The server accepts only listed names. A missing catalog means no site emoji; an invalid
  one stops startup.
- Chat history keeps the original file. Removed images stay published for the asset
  grace period, then show as unavailable.

## Voice

| Action | Behavior |
| --- | --- |
| Join | Explicit; requires microphone permission |
| Mute | Stops sending; unmuting while deafened also ends deafen |
| Deafen | Stops remote playback and mutes the microphone; ending it restores the previous mute (music unaffected) |
| Controls | Per-player volume and listening; input and output device selection |
| Navigation | Follows room membership across room, game, and profile pages |
| Leave, logout, disconnect, removal | Releases microphone and peer connections |
| Refresh, multiple tabs | Requires rejoining; one tab per account |

- Peer-to-peer WebRTC audio for up to twelve room members. During matches, seated
  players do not hear observers ([games](games.md#spectators-and-god-view)).
- Socket.IO relays only validated signaling ([API](api.md#voice-signaling)).
  **Voice is never recorded or stored.**
- Microphones need HTTPS or localhost. Permissions, autoplay, or missing devices can
  block audio even when connected.
- Each join gets a fresh peer ID, so stale signals cannot reach a new call. Peer errors
  are isolated; rejoining replaces failed links and keeps preferences.
- After a refresh, the client may retry for up to 45 seconds without taking over
  another active tab. Waits, message sizes, and queues are bounded.

**ICE configuration**

The default is `stun:stun.l.google.com:19302`. Restrictive NATs and firewalls need a
TURN relay. Set `VITE_WEBRTC_ICE_SERVERS` in `client/.env.local`, then rebuild and deploy:

```dotenv
VITE_WEBRTC_ICE_SERVERS=[{"urls":"stun:stun.example.com:3478"},{"urls":"turn:turn.example.com:3478","username":"browser-user","credential":"browser-credential"}]
```

- This value is **public**. Use short-lived or restricted TURN credentials, never private keys.
- Up to eight servers and sixteen URLs; schemes `stun:`, `stuns:`, `turn:`, `turns:`.
  Invalid configuration shows an error.
- Synthetic local streams verify neither real microphones nor cross-network routing.
