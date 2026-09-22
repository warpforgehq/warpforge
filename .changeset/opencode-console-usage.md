---
"warpforge": patch
---

OpenCode quota meters update again for accounts that sign in through the OpenCode console. OpenCode moved Go subscriptions to a console sign-in, so the usage figures could stop refreshing and show a 403 even while the plan was active; Warpforge now reads usage the same way the OpenCode app does and keeps showing the session, weekly and monthly windows.
