---
"warpforge": patch
---

The app no longer freezes while a busy task streams output. Previously, when one view fell behind on updates it could stop Warpforge from handling anything else, so actions like opening the push dialog appeared to hang until that view caught up. Replies are now written ahead of pending updates, and a view that misses some resynchronizes itself with a fresh snapshot instead of staying stale.
