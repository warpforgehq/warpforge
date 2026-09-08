---
"warpforge": patch
---

Review your GitHub pull requests without leaving the app. A new Inbox in the sidebar collects open pull requests across every project, with an unread badge that lights when a PR you follow gets new activity; each project page gains a Pull Requests tab listing its own. Pick a PR from the list and the review opens beside it at full width — press `j`/`k` to move through the list without leaving the diff.

Each review has two tabs. **Overview** reads like a document: the description, then every review and comment as a card underneath it, with a rail beside them for status, reviewers, branch and the changed files — grouped into implementation and documentation so you can see at a glance how much of a change is code and how much is prose. Click any file to jump straight to its diff. **Diff** is the code itself: switch between unified and side-by-side, filter or browse files as a folder tree, tick files off as you read them, and comment on any line by hovering its line number. Review threads appear on the lines they were written about, replies land on GitHub straight away, and you can approve or request changes from the tab bar. Review bodies from bots now render their callouts and collapsible sections properly instead of showing raw markup.

Big changes can be read one commit at a time: open **Commits** on the Diff tab and tick the commit you want, or tick two to read the run between them — the diff, the file list and the viewed marks all follow your selection, and "All commits" puts the whole change back. Switching between commits you have already opened is instant.

Status checks aren't shown yet. `[` and `]` step through files, and both rails collapse when you want the whole window for the diff.

Requires a GitHub connection (Settings → Trackers); `gh` CLI still works as a fallback.
