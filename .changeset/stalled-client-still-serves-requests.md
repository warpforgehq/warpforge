---
"warpforge": patch
---

The app no longer freezes while a busy task streams output. Previously, a view that fell behind on updates could stop the daemon from reading any further requests on its connection, so actions like opening the push dialog appeared to hang until it caught up. Requests are now served independently of that catch-up, and a view that misses updates resynchronizes itself with a fresh snapshot instead of staying stale.
