---
"warpforge": minor
---

Edit a project's setup without touching YAML. Open a project and pick **Config**, or right-click it and choose **Edit project**, to change services, environment variables, port forwards, the port range and worktree setup. Each value can be **Shared** with your team through the committed config or kept **Only me** on this machine — new environment variables start as Only me, and Warpforge asks before a secret-looking value goes into the shared file. Edits you or an agent make to the file by hand show up right away, with your comments kept; if the same value changed while you were editing, you pick which one wins. Services whose config changed are marked **Restart to apply**, here and in Runtime.
