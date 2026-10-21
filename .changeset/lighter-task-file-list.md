---
"warpforge": patch
---

Agent chats stay lighter on memory while they stream: a task no longer keeps a full listing of every ignored file, such as build output and dependencies, in memory and reloads it on every update.
