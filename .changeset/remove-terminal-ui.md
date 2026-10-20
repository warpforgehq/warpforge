---
"warpforge": minor
---

The terminal UI and the `add`, `remove`, `list`, `init` and `bootstrap` commands have been removed. Everything they did now lives in the desktop app: add a project in **Projects → Add Project**, and let an agent generate its config in the bootstrap wizard. The `warpforge` binary now only runs the local daemon the app is built on, and running it with no command prints help.
