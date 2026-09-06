---
"warpforge": patch
---

Tasks you mark handled now actually free the space their conversations used. Until now only tasks that finished on their own counted as closed, so anything you closed yourself kept its full transcript forever — invisible in the sidebar but still on disk, which is what made Warpforge slow down and grow over time. The retention window in Settings → Tasks now applies to them too, and counts from the day you closed the task rather than the last time anything touched it.
