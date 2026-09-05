# public/imported_audios/

Drop any sound effect or music file here that you want a scene to use. Reference
it from a scene with `staticFile("imported_audios/<filename>")`.

This is separate from `public/sfx/`, which is the synthesized pack `@openvidstudio/core`
ships (clicks, keystrokes, a bell, a whoosh, a music bed). Nothing in `sfx/` carries
third-party rights; anything you put here does, so credit the source in the video
description if its licence asks for it.

`plan_sound_effects` also writes here: it saves anything it fetches automatically
(via the `freesound` provider) into this folder, and for anything you have to
download by hand it writes the exact filename to save into `DOWNLOAD-THESE.md`
alongside this README.
