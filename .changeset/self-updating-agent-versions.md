---
"warpforge": patch
---

Agents that maintain their own updates no longer show a permanent, unusable update prompt. Warpforge only compares an agent against the npm registry when it can actually install that update; an agent installed through its own updater could previously be flagged forever even though there was nothing to update from the Agents page.
