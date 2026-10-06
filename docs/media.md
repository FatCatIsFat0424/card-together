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
pause/volume does not disable them. A browser gesture unlocks audio; blocked/obsolete
reminders are not queued. Reminders wait for the authoritative presentation deadline.

## Images and chat

Account settings support uploaded avatars, table backgrounds, and a shared custom emoji
library. Supported uploads are PNG/JPEG/GIF/WebP. Decoded limits are 512 KiB for avatars,
256 KiB for emoji, and 2 MiB for backgrounds. The proxy accepts 3 MiB JSON to fit base64
background uploads. Assets use SHA-256 content-addressed IDs and immutable controlled reads.

Emoji names use 2–32 lowercase letters/digits/underscores. Accounts may store 300 entries;
API imports accept up to 50 entries per batch. File/folder UI imports process images:
static emoji shrink to a 128-pixel long edge and WebP (PNG fallback); GIFs retain bytes.
Stickers reuse these assets and can look softer in their larger display box.

Chat accepts trimmed text of 1–500 characters, with `:name:` tokens resolved only from
the sender's library (up to 20 resolved emoji names), or a standalone owned sticker ID.
Clients cannot choose arbitrary
URLs or another account's image. Sticker sends preserve text drafts and prevent duplicate
pending sends. Ordinary text stays text; missing assets show unavailable labels.
See [API](api.md) for payloads. Room chat remains available independently of voice settings.

## Voice

A user explicitly joins room voice and grants microphone permission. Mute stops local
transmission; deafen stops remote playback independently of background music. The UI
also supports per-player volume/listening and available input/output device selection.
Voice follows room membership across room/game/profile pages. Leave, logout, disconnect,
or room removal releases microphone/peer resources. Refresh requires explicit rejoin.
One account can join from only one tab at a time.

WebRTC exchanges audio among up to four members (three remote peers each); Socket.IO
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
