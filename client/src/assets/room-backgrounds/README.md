# Waiting-room seat artwork

`bot-seat.webp` is the default background for every occupied bot seat. Human seats
use each player's uploaded `seatBackground`; empty seats keep the theme surface.
The image is imported by `RoomPage`, so Vite bundles it with the correct
deployment base path. A theme-colored gradient keeps overlaid identity and controls
readable.

Generated with the built-in imagegen tool, then encoded as a 768 × 1152 WebP with
Sharp (quality 82). The generation prompt was:

> Use case: stylized-concept. Create one polished portrait illustration, 2:3 aspect ratio, as a default background image behind a bot player seat card in a modern online card-game waiting room. Subject: a friendly sophisticated mechanical card dealer with brushed midnight-blue metal, a softly glowing cyan faceplate, subtle bronze joint details, holding a small fan of ordinary playing cards. Scene: a dark navy casino alcove with faint cyan circuit traces, quiet atmospheric depth and soft rim light. Composition: robot head in the upper third, torso below, a spacious dark central band suitable for an overlaid avatar and nickname; important silhouette comfortably inside the central 60% so responsive cover cropping still works. Style: premium painterly game character concept art, elegant and approachable, detailed material texture, restrained saturation, luminous accents. No text, numbers, logo, watermark, UI, buttons, borders or frame. Output only the complete opaque portrait background illustration.
