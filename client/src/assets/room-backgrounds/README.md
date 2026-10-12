# Waiting-room seat artwork

`bot-seat.webp` is the background for every occupied bot seat. Human seats use the
player's uploaded seat background; empty seats use the theme surface.

- `RoomPage` imports the image, so Vite bundles it with the deployment base path.
- A theme-colored gradient keeps the overlaid identity and controls readable.
- Generated with the built-in imagegen tool and encoded with Sharp as a 768 × 1152 WebP
  (quality 82).

Prompt:

> Use case: stylized-concept. Create one polished portrait illustration, 2:3 aspect ratio, as a default background image behind a bot player seat card in a modern online card-game waiting room. Subject: a friendly sophisticated mechanical card dealer with brushed midnight-blue metal, a softly glowing cyan faceplate, subtle bronze joint details, holding a small fan of ordinary playing cards. Scene: a dark navy casino alcove with faint cyan circuit traces, quiet atmospheric depth and soft rim light. Composition: robot head in the upper third, torso below, a spacious dark central band suitable for an overlaid avatar and nickname; important silhouette comfortably inside the central 60% so responsive cover cropping still works. Style: premium painterly game character concept art, elegant and approachable, detailed material texture, restrained saturation, luminous accents. No text, numbers, logo, watermark, UI, buttons, borders or frame. Output only the complete opaque portrait background illustration.
