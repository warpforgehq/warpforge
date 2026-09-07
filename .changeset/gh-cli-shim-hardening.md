---
"warpforge": patch
---

Harden the gh CLI shim: disable pagers via env, cache the resolved repo per invocation, spawn the query thread once, and pass issue bodies with `--body-file` to avoid arg-length limits.
