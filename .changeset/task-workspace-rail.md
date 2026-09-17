---
"warpforge": patch
---

A task's workspace is now switched from a single strip of icons that never goes away, instead of a row of tabs that disappeared whenever one half took the full width. The conversation, project tree, changes, runtime, terminal and pipeline are all one click apart whatever state the split is in, and the strip keeps showing which half is open — including the half you folded away. Each pane's header offers two plain actions, "make this full width" and "put it away", rather than a single toggle whose second meaning you had to discover; once a pane owns the screen, its restore control is drawn on that pane's own side of the split, so undoing it no longer means reaching into the other pane's header. Switching between surfaces slides a highlight between the icons, and hovering one names the surface and what it holds.
