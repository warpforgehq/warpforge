---
"warpforge": minor
---

Turn a chat into a project. When the files a chat produced deserve a home of their own, **Create project from chat…** in the chat's footer copies them into a new folder (`~/workspace/<chat title>` by default), adds it as a project, optionally makes it a git repository with a first commit, and continues the conversation in a new task there. Dependency folders such as `node_modules` and `.venv` are left behind to be reinstalled, a folder that already holds files is never merged into, and the chat keeps its own copy.
