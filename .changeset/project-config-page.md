---
"warpforge": minor
---

**Set up a project without touching YAML.** Open a project and pick **Config**, or right-click it and choose **Edit project**, to change services, environment variables, port forwards, the port range and worktree setup. The page and `workspace.yaml` stay in sync both ways: edit the file by hand and the page updates, with your comments kept; save from the page and the file changes. If the same value changed in both places, you choose which one wins.

Each value is either **Shared** with your team through the committed file or kept **Only me** on this machine. New environment variables start as Only me, and Warpforge asks before a secret-looking value goes into the shared file. A broken file shows the exact line to fix, and services whose setup changed are marked **Restart to apply**.

Per-project agent templates are retired; agents use the commands set in Settings → Agents.
