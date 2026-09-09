---
"warpforge": patch
---

The code editor and the terminal work again in the installed app. Opening a file or a diff drew line numbers beside empty space — text turned up in the wrong font with its indentation gone, or only the tail of the file showed at all — and the terminal took neither a cursor nor a keystroke. Everything the editor, the diff viewer and the terminal style themselves with was being thrown away as the window loaded, so syntax colours, the monospace font and the whole line layout never arrived. This only ever affected released builds, which is why it could sit unnoticed while the app was run from source. The app also stops falling back to a slower channel for talking to its background service.
