# Music, images, and voice

## Background music

The playlist contains audio files supplied by the site owner. Players cannot upload
music or enter URLs. The menu supports play/pause, previous/next, repeat-one,
sequential/shuffle modes, and volume. Native audio playback survives route changes and
closing controls; pause preserves position. Reload starts stopped. Volume defaults to
25%; volume/track/mode are local browser preferences and tolerate unavailable storage.

Place sources in ignored `local-music/` at the repository root:

```sh
npm run music:import
```

Client `predev` and `prebuild` automatically import before development/build, including
workspace commands. If files change during development, rerun import and refresh.
There is no background watcher.

- Recursively accepts MP3, OGG, WAV, M4A, AAC, and FLAC, case-insensitively.
- Titles are filenames without extension; natural relative-path order determines
  playlist order. Prefix numbers to choose ordering.
- Relative paths generate stable track IDs; moving/renaming changes identity.
  Content-hashed output filenames invalidate caches for replaced bytes.
- Copies original bytes without transcoding/level changes. Codec support depends
  on the browser; MP3 is a broadly supported choice. Import validates structure,
  paths, and nonempty files, not audio decodability.
- Rejects symlinks/empty audio before replacing the active catalog; ignores unsupported
  files and removes only stale importer-owned output.

Generated outputs are `client/src/audio/provided-music.generated.json` and
`client/public/provided-music/imported-*`; do not edit them. Sources and outputs are
Git-ignored. A fresh checkout has an empty playlist; build on a machine with the desired
sources. Import alone does not update a deployed site: rebuild and publish the frontend
as described in [deployment](deployment.md#frontend-only-publication), then reload.

Instrument/sample libraries, original composition catalogs, audition pages, and rendering
tools were moved to the separate `~/daw-tmp` workspace. The game does not depend on them.
Turn reminders remain an independent synthesized chime, enabled by default: music
pause/volume does not disable them. A browser gesture (including click/touchend for iOS)
unlocks audio; blocked/obsolete reminders are not queued. Music reuses one audio element
across tracks so automatic track changes keep the gesture unlock. Reminders wait for the authoritative presentation deadline.

## Images and chat

Account settings support uploaded avatars, table backgrounds, card backs, and a shared
custom emoji library. Supported uploads are PNG/JPEG/GIF/WebP. Decoded limits are 512 KiB
for avatars and card backs and 2 MiB for emoji and backgrounds. The proxy and server accept
3 MiB JSON, which fits a base64-encoded 2 MiB image. Assets use SHA-256 content-addressed
IDs and immutable controlled reads.
Each account has an upload quota; see [API](api.md) for the limit and its accounting. Large
animated emoji can reach that quota before the 300-entry library cap.

Table backgrounds and card backs are personal display settings: only the owner sees them,
nothing is broadcast, and game state is unchanged. A card back replaces every face-down
card on the owner's screen, covering the card face (centered, cropped); without one the
theme's default back is used. The account page resizes uploads before sending them
(backgrounds to a 1920-pixel and card backs to a 512-pixel long edge, WebP with JPEG
fallback). Each image has an opacity of 20–100% (default 100%) that fades only the image
layer, revealing the theme table surface or card base beneath; slider changes save after a
short pause or on release.

Emoji names are 2–64 ASCII letters, digits, `_`, `-`, or `.`, starting with a letter, digit,
or `_` (`EMOJI_NAME_PATTERN` in [shared constants](../shared/src/constants/emoji.ts)). Names
are case-sensitive: `Cat` and `cat` are different emoji. Names valid under the earlier
lowercase 2–32 rule remain valid. Accounts may store 300 entries; API imports accept up to
50 entries per batch. File/folder UI imports process images: static emoji shrink to a
128-pixel long edge and WebP (PNG fallback); GIFs retain bytes and must be at most 2 MiB.
Names come from file names: a valid name is kept, otherwise other characters become `_`,
repeats collapse, and leading separators and trailing `_` are removed (`emoji` when too
little remains); duplicates get `_2`, `_3`, and so on.
Besides the file and folder pickers, the account page imports images and folders dropped
onto the library and images pasted while it has focus, through the same pipeline. A name
filter narrows the grid. Select mode adds a checkbox to each tile (shift-click selects a
range); select all applies to the filtered list, and one confirmation deletes the visible
selection in a single request. Deleting library entries does not delete uploaded images.
Stickers reuse these assets and can look softer in their larger display box.

Chat accepts trimmed text of 1–500 characters, with `:name:` tokens resolved from the
sender's library and then from the [site-provided emoji](#site-provided-emoji) (up to 20
resolved names in total), or a standalone sticker: an owned sticker ID or a provided emoji
name. Clients cannot choose arbitrary
URLs or another account's image. Sticker sends preserve text drafts and prevent duplicate
pending sends. Ordinary text stays text; missing assets show unavailable labels.
See [API](api.md) for payloads. Room chat remains available independently of voice settings.

## Site-provided emoji

The site owner can supply chat emoji that every account may use, inline as `:name:` or as
a sticker. The chat picker lists them in a separate section after the personal library.
When a name exists in both, the sender's own emoji wins in text, so the picker hides the
shadowed site emoji while inserting; both remain available as stickers.

Place images in ignored `local-emoji/` at the repository root (subfolders allowed):

```sh
npm run emoji:import
```

Client `predev` and `prebuild` run this import after the music import. A missing or empty
folder produces an empty catalog: the picker shows no site section and the build succeeds.

- Accepts PNG, JPEG, GIF, and WebP files (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`,
  case-insensitive); other files are ignored. The output type comes from the file's magic
  bytes. Unreadable files and content that is not one of these images are skipped.
- The emoji name is the file name without extension, using the personal emoji name rules.
  Invalid names never fail the import: they are normalized like UI imports (whitespace and
  other characters become `_`, repeats collapse, leading separators and trailing `_` are
  removed, at most 64 characters), and a name with fewer than 2 characters left becomes
  `emoji_<6 hex of the path hash>`.
- Names are unique across all subfolders and extensions, case-sensitively. Files whose own
  name is valid keep it, first in sorted path order; other duplicates get `_2`, `_3`, and so
  on in sorted path order.
- Files up to 2 MiB, the personal emoji upload limit, are published unchanged. Larger
  images are compressed with build-time `sharp`: resized to at most a 256-pixel long edge
  (never enlarged) and encoded as WebP, animated input as animated WebP with every frame
  and its timing. If the result is still over 2 MiB, smaller sizes and lower quality are
  tried down to 96 pixels; an image that still does not fit is skipped.
- The import succeeds with a summary of compressed files (before/after sizes) and
  warnings for renamed and skipped files; fix or rename sources and rerun if needed.
- Symlinks are refused and fail the import before anything is replaced; only stale
  importer-owned output is removed.
- Output names are `<name>-<content hash>.<type>`, so replaced images get new cacheable
  URLs. Chat history keeps the file it was sent with; removed or replaced images stay
  published for the asset grace period, then show the unavailable label.

Generated outputs are `shared/src/provided-emoji.generated.json` and
`client/public/provided-emoji/<name>-*`; do not edit them. Sources and outputs are
Git-ignored. The client bundles the catalog for the picker, while the server reads the same
file at startup (a missing file means no site emoji; an invalid one stops startup) and
accepts only names in it. Restart the development server after importing. In production,
publish changed emoji with the full [deployment](deployment.md#build-and-deploy), not the
frontend-only publisher, so the backend loads the new catalog.

## Voice

A user explicitly joins room voice and grants microphone permission. Mute stops local
transmission; deafen stops remote playback independently of background music. The UI
also supports per-player volume/listening and available input/output device selection.
Voice follows room membership across room/game/profile pages. Leave, logout, disconnect,
or room removal releases microphone/peer resources. Refresh requires explicit rejoin.
One account can join from only one tab at a time.

WebRTC exchanges audio among up to twelve members (the room limit); during a match a player
still in it mutes observers on its own side, since audio is peer to peer
([spectators](games.md#spectators-and-god-view)). Socket.IO
relays validated session/room/peer-bound signaling only. Voice is not recorded or saved.
HTTPS or localhost is required for microphone access. Browser permissions/autoplay or
unavailable devices can prevent audio even when transport reports connected.

Default ICE uses `stun:stun.l.google.com:19302`. Restrictive NAT/firewalls need an operated
TURN relay. Set `VITE_WEBRTC_ICE_SERVERS` in `client/.env.local` and rebuild/redeploy:

```dotenv
VITE_WEBRTC_ICE_SERVERS=[{"urls":"stun:stun.example.com:3478"},{"urls":"turn:turn.example.com:3478","username":"browser-user","credential":"browser-credential"}]
```

This public configuration accepts at most eight servers/sixteen URLs using
`stun:`, `stuns:`, `turn:`, or `turns:`; invalid configuration surfaces an error.
Use browser-appropriate short-lived/restricted TURN credentials, not private app keys.
A local synthetic-stream test does not verify real microphones or cross-network routing.

Each join cycle has a fresh peer ID; stale signaling cannot attach to a new call.
Peer errors remain independent. Rejoin replaces failed links while preserving preferences;
a refresh may retry an expired duplicate-tab membership for up to 45 seconds without
seizing another active tab. Peer connection waits are bounded; failures release the
failed link while retaining other calls. SDP/candidate sizes and signaling queues are bounded.
