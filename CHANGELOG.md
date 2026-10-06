# Changelog

## 0.24.0

### Minor Changes

- [`421e284`](https://github.com/warpforgehq/warpforge/commit/421e28415d159671efbd9457ae3559e0714710d2) Thanks [@ephor](https://github.com/ephor)! - Agents can now open GitHub and Linear issues for you. Ask an agent to file something on GitHub or Linear and it creates the issue and adds a linked item to your backlog, just like **New work item** does. Without that request, agents still file follow-up work only in your backlog.

- [`0808d89`](https://github.com/warpforgehq/warpforge/commit/0808d89bf991229896f2cfc3c7206c6075a60c40) Thanks [@ephor](https://github.com/ephor)! - New Claude tasks now start in Claude's **Auto** mode instead of **Manual**, so routine steps go ahead without stopping for your approval each time. Prefer to approve every step? Pick **Manual** under **More → Mode** when you create the task or from the composer.

## 0.23.0

### Minor Changes

- [`c310493`](https://github.com/warpforgehq/warpforge/commit/c310493aa3b61ad6e71f2969840219d4c6b792d5) Thanks [@ephor](https://github.com/ephor)! - Meet **Factory**, a new way to run a task: pick **Factory** in New Task and a workflow runs your change through implement, review and fix — and, with **Test in the running app**, checks it in your app's browser first. Tick **Open a draft PR when done** and Warpforge commits the change on a fresh branch, pushes it and opens a draft pull request for you to review; leave it off and you get the change to review and commit yourself, just like the old Workflow mode. Where it runs is chosen for you — your project folder when it tests the running app, a background copy otherwise — and one click on **Change** picks the other. Start straight from your backlog with **Start in Factory** on an item, **Start 3 in Factory** on three selected items, or **Run in Factory…** to start every item that matches a filter; each item becomes its own task, and a PR that merges marks its item done. Factory tasks sit in the sidebar with their stage — Implementing, Reviewing · round 2/3, Opening PR, PR #41 — and when the project's limits hold one back it shows as **Queued** with the reason and starts on its own, or right away with **Start now**. Set those limits, and the defaults New Task starts with, under **Factory settings…** in the project menu. Your work is safe: Warpforge never stashes or discards changes in your project folder, and if it cannot switch the folder back after a task, **Needs you** says why with **Try again** and **Open terminal**. A failed or stopped task offers **Run again**, and agents can start Factory tasks for backlog items too.

- [`ebdd4ec`](https://github.com/warpforgehq/warpforge/commit/ebdd4ec6c0900979b3ada26cdbe94e376ea41d54) Thanks [@ephor](https://github.com/ephor)! - Orchestrator chats can now ship work through the Factory. Ask an orchestrator to build something and open a pull request, and it starts a Factory task for that goal — or for a backlog item — that waits for your project's Factory limits, shows in the sidebar, and ends as a draft pull request for you to review; merging it marks the linked item done. The orchestrator can choose the lead agent and model and where the task runs, and without a pull request its pipelines still run as its own helpers and report back to it, as before.

- [`20f7539`](https://github.com/warpforgehq/warpforge/commit/20f75399196d26689edeba15d177cbedc074772d) Thanks [@ephor](https://github.com/ephor)! - Keep your own runtime setup without touching the shared config: put overrides in `.warpforge/workspace.local.yaml` and they are layered over the project's config. Point a service at a port-forward instead of a local dependency, change a port, add a service only you run, or drop a forward you never use. The file is kept out of git automatically, edits apply as you save, and Runtime marks the services and port-forwards it changed with a "local" badge.

- [`c310493`](https://github.com/warpforgehq/warpforge/commit/c310493aa3b61ad6e71f2969840219d4c6b792d5) Thanks [@ephor](https://github.com/ephor)! - Workflows can now test a change in the running app before anyone reviews it. Add a `verify` stage, or pick the new **Implement + verify + review loop** built-in: after the implementation and after each fix, an agent starts your dev services, walks through the flow the task describes in the in-app browser, checks the console for errors and takes screenshots. A failure goes straight back to the fix stage; only a pass reaches the reviewers, and if verification keeps failing the task waits for you in **Needs you**. The verdict, the checklist and the screenshots are on the verify stage in the Pipeline view and in the pipeline's final summary. Keep the desktop app open while it runs; tasks in their own worktree can't be verified yet.

### Patch Changes

- [`ebdd4ec`](https://github.com/warpforgehq/warpforge/commit/ebdd4ec6c0900979b3ada26cdbe94e376ea41d54) Thanks [@ephor](https://github.com/ephor)! - Factory tasks now always run on the agent you chose. Starting from the backlog with **Start in Factory**, several items at once, or **Run again** picks up the lead agent and model from the project's **Factory settings…**, and a harness you pick in New Task wins over them. A model is only ever used with the agent it belongs to: pick a different agent and it runs on that agent's own default, and a stage in your workflow that names its own agent without a model does the same.

- [`d5e54ce`](https://github.com/warpforgehq/warpforge/commit/d5e54ce9679abadcb8285f97ed095b30b6999ec1) Thanks [@ephor](https://github.com/ephor)! - A Factory task's sidebar row now shows its pull request as one chip: the PR number carries the state — draft, open, merged or closed — and a small dot when checks are failing or still running, so a glance tells you where the change stands. Click the chip to open the pull request on GitHub. Factory tasks stand out from orchestrator runs too: a pipeline now wears its own workflow icon with its stage count, instead of the same people icon.

- [`43db3b7`](https://github.com/warpforgehq/warpforge/commit/43db3b7c73e2cdf4357e58a725835b31cac8b7fc) Thanks [@ephor](https://github.com/ephor)! - Items synced from GitHub or Linear keep the status the Factory gives them while it works on them, so a sync no longer flips a running item back to _To do_.

- [`de9f270`](https://github.com/warpforgehq/warpforge/commit/de9f27093a67f160db07021894b5077af76564a9) Thanks [@ephor](https://github.com/ephor)! - Pull request feedback and review notes now reach a finished workflow pipeline. **Send to agent** and **Send N notes** hand them to the stage that last changed the code, and the notice names that stage, so failing checks and review comments on a pipeline's pull request no longer sit there with nowhere to go.

- [#52](https://github.com/warpforgehq/warpforge/pull/52) [`20a27ea`](https://github.com/warpforgehq/warpforge/commit/20a27eac017ce3d72fdfc7d8edf323f933ea08bc) Thanks [@ephor](https://github.com/ephor)! - Service and port-forward logs now go to the chat as a context chip. Select lines in a Runtime log and press ⌘L (Ctrl L), or click **Add to chat**: the agent gets those lines with their range and UTC times, and can read the lines around them on its own. A failed service shows **Send last failure**, which attaches its latest output in one click.

- [`14411ba`](https://github.com/warpforgehq/warpforge/commit/14411ba1605184ed402c755eac059d8c33b6ccb2) Thanks [@ephor](https://github.com/ephor)! - The button that expands a pane to fill the task view now shows an expand arrow instead of a square, so it no longer looks like Stop.

- [`de9f270`](https://github.com/warpforgehq/warpforge/commit/de9f27093a67f160db07021894b5077af76564a9) Thanks [@ephor](https://github.com/ephor)! - A workflow pipeline that Warpforge had to pause on its own now shows up in **Needs you** with the reason: an account out of quota, a stage whose agent quit, or a restart mid-stage. Pipelines you paused yourself stay out of the list.

- [`a3d6c89`](https://github.com/warpforgehq/warpforge/commit/a3d6c892dcc9d049930ba4da643aa900f55a5fbd) Thanks [@ephor](https://github.com/ephor)! - Messages waiting behind a working agent can now be edited or removed before they are sent, and a removed message can be restored with Undo.

## 0.22.1

### Patch Changes

- [`85b26be`](https://github.com/warpforgehq/warpforge/commit/85b26bed056e3e9922ca63eff20cae07539e5441) Thanks [@ephor](https://github.com/ephor)! - Services that depend on a port-forward start again when you run that dependency locally. If a local ClickHouse, Postgres, or your own `kubectl port-forward` already answers on the forward's local port, Warpforge uses it and starts the service right away instead of trying to open a forward that can't bind; the service's log says it is using the local server. If the port is held by something that doesn't accept connections, the service now fails with a reason naming the port, so you know what to stop.

- [`2f84ef1`](https://github.com/warpforgehq/warpforge/commit/2f84ef1a43d635cf9e7d03a4e10b9a900dd37abf) Thanks [@ephor](https://github.com/ephor)! - The wrong-port warning on a service now names only ports that actually answer, so a service that also starts other dev servers no longer points you at the wrong one. Starting a port-forward by hand now fails right away, with a clear reason, when its local port is already served by another process.

## 0.22.0

### Minor Changes

- [`c0a1601`](https://github.com/warpforgehq/warpforge/commit/c0a160153e2f7fe568f262eab244cf72ac238d8d) Thanks [@ephor](https://github.com/ephor)! - Grok Build is now a supported agent. Warpforge detects the `grok` CLI when it is installed, shows its version, and can install or update it from the agent panel. Pick Grok Build when you start a task, the same way you pick Claude Code or Codex.

- [`fdb13b8`](https://github.com/warpforgehq/warpforge/commit/fdb13b896fb33f2b2db6949593af1b270202d9ad) Thanks [@ephor](https://github.com/ephor)! - Merge a task's work back into its base branch from the task itself. **Merge into the base branch** in the branch menu fast-forwards when it can and writes a merge commit otherwise, all without disturbing your own checkout — it only touches a checkout that already has the base branch, and only when that checkout is clean. A conflict changes nothing and tells you what to do. Merging removes the worktree and finishes the task unless you clear the option.

### Patch Changes

- [`7f167f5`](https://github.com/warpforgehq/warpforge/commit/7f167f55c44b67eae395441e362bd760aac25fbd) Thanks [@ephor](https://github.com/ephor)! - Give a single-agent task an advisor: turn on **Advisor** in New Task and pick a second harness or a stronger model — Claude Code working with Codex advising, or the reverse. The agent consults it before big design decisions, when it is stuck, and before it calls the task done, and the advisor answers knowing the task's goal, the recent conversation and the changed files, not just a diff. Each consultation shows up in the chat as a collapsed "Asked advisor" block with the question, the answer and what it cost. The advisor only reads: it can never edit your code.

- [`f204799`](https://github.com/warpforgehq/warpforge/commit/f204799a17682d92e57d6cb64524974b2bedee92) Thanks [@ephor](https://github.com/ephor)! - Warpforge now shows the real reason an agent cannot start instead of a generic "rejected" message, and checks that an agent actually launches after an install or update. If a global install is missing the native binary it needs, Warpforge repairs it automatically — and offers a Reinstall button in Settings → Agents when it cannot.

- [`c54e352`](https://github.com/warpforgehq/warpforge/commit/c54e35229200aefe7f6472a76968404eafeb9051) Thanks [@ephor](https://github.com/ephor)! - Agents can now add backlog items and manage automations from any session. Claude no longer rejects the add-to-backlog tool, and agents working in a project can create, list, edit, run and delete automations without being an orchestrator. New automations default to the project the agent is working in, and keep the session-reuse and missed-run choices the agent sets.

- [`22f625c`](https://github.com/warpforgehq/warpforge/commit/22f625c0f5f36ce0417f72bf7ad3523bcdd1ca5f) Thanks [@ephor](https://github.com/ephor)! - Agents can now use the in-app browser themselves. Ask one to open your app, click through a flow, fill in a form or read the page's console errors, and it works in its own Agent tab in the Browser, next to yours — reading the page, clicking, typing, taking screenshots and checking the console as it goes, so you can watch it and your own tabs are left alone. When the Browser pane isn't open, pages load in the background without taking over your screen. Your project's own dev services are open to the agent right away; any other site asks you first in the task's chat, because the browser is signed in as you — allow it once, for the rest of the task, or deny it.

- [`f957b37`](https://github.com/warpforgehq/warpforge/commit/f957b376daff3c781a4507f1699db1d43defa8dc) Thanks [@ephor](https://github.com/ephor)! - Agents can now work with your backlog, not just add to it. They can list items, read one in full by its number (the "#87" you see in the app), change its title, description, status or priority, and close it as done or not planned with a short closing note, so the backlog stays current as agents finish the work it describes.

- [`33027c1`](https://github.com/warpforgehq/warpforge/commit/33027c12a7bc9537f0e061ce80446c0640ff1da9) Thanks [@ephor](https://github.com/ephor)! - The in-app browser always has a tab ready. Type an address or a search and press Enter to go straight there, even after closing your last tab, without having to press + first.

- [`33027c1`](https://github.com/warpforgehq/warpforge/commit/33027c12a7bc9537f0e061ce80446c0640ff1da9) Thanks [@ephor](https://github.com/ephor)! - Reload in the in-app browser now always fetches the page fresh instead of sometimes showing a cached copy of your app. If a change doesn't appear on its own, Reload will pick it up — no more closing the tab and opening a new one.

- [`33027c1`](https://github.com/warpforgehq/warpforge/commit/33027c12a7bc9537f0e061ce80446c0640ff1da9) Thanks [@ephor](https://github.com/ephor)! - The in-app browser now stays in its own pane. Switching to the conversation, from the chat button in the right rail or by maximizing it, hides the page instead of leaving it painted over the chat and the message box.

- [`3b400c1`](https://github.com/warpforgehq/warpforge/commit/3b400c1850926e9e68074d6a8baaff73e2688fc0) Thanks [@ephor](https://github.com/ephor)! - The in-app browser no longer covers dialogs, menus and notifications. Opening settings, the push dialog or quick open now shows it on top and lets you click it, and the page comes back exactly where you left it once the dialog closes. A menu or notification that overlaps the page makes the page step aside for it instead of hiding it. Switching tasks or tabs and returning to the browser also keeps each page as it was, with no reload, and tabs keep their titles and back history.

- [`9210a3f`](https://github.com/warpforgehq/warpforge/commit/9210a3fed4e56df40b3aab0220af15474a646c03) Thanks [@ephor](https://github.com/ephor)! - The chat no longer twitches while you follow a streaming answer. The newest text stays pinned to the bottom on every frame, so you can read along without the view jumping back and forth.

- [`d93744c`](https://github.com/warpforgehq/warpforge/commit/d93744c8fa4be2b81f90b63ac8ac2fb4765b1010) Thanks [@ephor](https://github.com/ephor)! - Reading earlier messages in a long chat now stays put while the agent keeps working. Scroll up to read, and the text under your eyes no longer jumps away as new tool calls stream in or when you approve a request — even in conversations with thousands of steps.

- [`a05073d`](https://github.com/warpforgehq/warpforge/commit/a05073df9b45cb78791fba2b55c0b3911098263b) Thanks [@ephor](https://github.com/ephor)! - After `/compact`, the "Compact conversation" step in the chat now shows as finished instead of spinning forever. The same goes for any step an agent left open when its turn ended. A completed turn marks those steps done, a stopped turn marks them failed, and conversations you already have are corrected when you open them.

- [`9b99b6e`](https://github.com/warpforgehq/warpforge/commit/9b99b6eafe3d49d7b16e0901ebc0c0e708487936) Thanks [@ephor](https://github.com/ephor)! - Arrow keys no longer type stray box characters on macOS. Pressing Right Arrow at the end of a message, or Left Arrow at its start, used to add an invisible character with every press. This happened in the chat box, the address bar and every other text field. Now nothing happens, as you'd expect.

- [`e837ee1`](https://github.com/warpforgehq/warpforge/commit/e837ee117b4dfa9a6293dbe9cfd836ae61e8a7e7) Thanks [@ephor](https://github.com/ephor)! - Warpforge's background service now refuses connections from web pages you visit, and keeps its access key private to your user account. File previews can no longer be pointed at files outside the project.

- [`bb336d9`](https://github.com/warpforgehq/warpforge/commit/bb336d9d8a3aee5f2d886678feb45ccd0f89f0db) Thanks [@ephor](https://github.com/ephor)! - Review the agent's changes line by line. Hover any line in a task's diff, click **+** (or drag for a range) and write a note; ⌘⏎ saves it. **Send N notes** hands every note to the agent as one message, with the file, line numbers and quoted code for each, and waits its turn if the agent is still working. Notes stay on the diff afterwards so you can check each fix, resolve the ones that are done and resend the rest. A note follows its code when the agent moves it, and is marked outdated when that code is gone.

- [`28160f9`](https://github.com/warpforgehq/warpforge/commit/28160f9e125efad052a648fc1e5fe5444d007508) Thanks [@ephor](https://github.com/ephor)! - When Warpforge can't save a file you edited, it now tells you why instead of quietly keeping your changes only on screen. A message names the file and the reason, for example a path that leads outside the project, so you know the edit didn't reach disk.

- [`70ba56b`](https://github.com/warpforgehq/warpforge/commit/70ba56be9dbc46a8368d0d84debb1595ff52b61a) Thanks [@ephor](https://github.com/ephor)! - Answering a permission request in two places no longer flips its outcome: the first answer wins, a second one is refused, and the macOS notification is withdrawn once you answer so a stale banner can't be tapped later. Pipeline questions work the same way — an answer is tied to the question you saw, so a late reply can't land on a newer one.

- [`22f625c`](https://github.com/warpforgehq/warpforge/commit/22f625c0f5f36ce0417f72bf7ad3523bcdd1ca5f) Thanks [@ephor](https://github.com/ephor)! - There is now a Memory screen in the sidebar. Browse everything your agents have saved, search it, and filter by scope, kind or tag. Open a memory to edit or delete it, see which task saved it, view its links, and add links between memories, including memories that belong to a project. Suggestions from dreaming wait on a Proposals tab, where each one says what approving will do: duplicates and stale memories are removed after you confirm, other kinds are marked done for you to handle by hand. When an agent approves a suggestion, nothing is deleted until you press Apply. Searching for text like `#82` now works instead of failing.

- [`5e5d837`](https://github.com/warpforgehq/warpforge/commit/5e5d837ee650ab2d6068c24332fd59ec5a082057) Thanks [@ephor](https://github.com/ephor)! - Orchestrator chats keep their delegation tools when they reconnect. After Warpforge restarts, a long-running orchestrator can still spawn and message agents, read its inbox and run workflows, even if you also added Warpforge to Claude Code yourself. If Warpforge is briefly unreachable, a tool call now says so and the next one reconnects, instead of the tools going quiet.

- [`1798802`](https://github.com/warpforgehq/warpforge/commit/17988022e4a4ac2d2a8640df3074cd5345431369) Thanks [@ephor](https://github.com/ephor)! - Permission prompts no longer get stuck. When a task stops, is cancelled or is deleted while a request is open, the request closes and its buttons go away. A tap that loses the race to another answer now shows the answer that actually won. Approving from a macOS notification picks a one-time approval. If the request offers only a lasting grant, Warpforge opens the task instead. Settings → Agents also updates a broken-install warning the moment Warpforge notices it.

- [`7f167f5`](https://github.com/warpforgehq/warpforge/commit/7f167f55c44b67eae395441e362bd760aac25fbd) Thanks [@ephor](https://github.com/ephor)! - Failed checks and review comments on a pull request now find their way back to the task that opened it. When CI fails or a reviewer leaves a comment, the task moves to Needs you with a notice such as "PR #12: 2 checks failed · 3 new comments". Press **Send to agent** and the same agent gets all of it in one message, in the same conversation: each failing check with its link and the command to read its log, then each comment with its file, line, quoted code and author. If the agent is busy, the message waits its turn. **Dismiss** clears the notice, and nothing you have already sent is raised again. The Checks section of a pull request in the Inbox now lists every check on the latest commit, failures first, each linking to its run.

- [`ac25cc4`](https://github.com/warpforgehq/warpforge/commit/ac25cc4a13f57c07c096fc4d92455bbe5cd102f9) Thanks [@ephor](https://github.com/ephor)! - Quitting Warpforge now quits it. Closing the window, pressing ⌘Q or choosing Quit from the Dock menu stops the agents, services and port-forwards Warpforge started and shuts down the local engine behind the app — after one prompt that lists what is running, with a Wait button if you are not ready. A background engine you started yourself from the CLI is left untouched, and your conversations and task history are kept exactly as before.

- [`01bc1af`](https://github.com/warpforgehq/warpforge/commit/01bc1af0319180ff772c7af97a3872b8e6e6d222) Thanks [@ephor](https://github.com/ephor)! - If Warpforge quits unexpectedly, the next launch no longer gets stuck on a frozen background engine. Warpforge now checks that the engine left running actually responds before connecting to it: one the app started is restarted automatically, and one you started yourself from the CLI is left running, with a clear message that it is not responding so you can stop it and relaunch. Reopening Warpforge while it is still shutting down now waits for the engine to finish stopping your services instead of cutting it off.

- [`3c48788`](https://github.com/warpforgehq/warpforge/commit/3c48788bf90c4353761ae2f0d84e8a8ab84458fc) Thanks [@ephor](https://github.com/ephor)! - Services that never come up no longer sit in "starting" forever. If a service isn't ready within five minutes, it is marked failed, and its log says why, for example the health endpoint answering 503 or nothing listening on its port. The process keeps running, so you can still read its logs, and Stop and Restart stay on its row. Starting all services leaves it running rather than starting it over. If it comes up late, it switches back to running on its own, and anything waiting on it starts then. Set `readyTimeout` on a service, such as `90s`, `10min` or `1h`, to make that window shorter or longer. Services with a `healthcheck` are now actually checked: they count as running once the URL answers, including a local `https` endpoint with a self-signed certificate. A service that depends on another now waits until that one is ready before it starts. If the dependency fails, the dependent is marked failed with a reason naming it, so it never starts against a service that isn't up.

- [`bcd4e3c`](https://github.com/warpforgehq/warpforge/commit/bcd4e3c86e4d053d1ac3a97a40eedbb1ceb41296) Thanks [@ephor](https://github.com/ephor)! - Settings now flags an agent whose install is broken as soon as Warpforge notices — from a background check or a task that couldn't start it — not just after you press Install or Update. A one-click Reinstall is right there when it can fix it.

- [`f0e6ba9`](https://github.com/warpforgehq/warpforge/commit/f0e6ba90737f077259e1def66211937c44049672) Thanks [@ephor](https://github.com/ephor)! - Warpforge no longer starts unattended work on an agent account that has run out of quota. A scheduled or manual automation run is recorded as "Skipped · quota" with the account and the time its limit resets, instead of starting an agent that fails right away. A workflow pauses before the stage that would need the exhausted account and tells you why; press Resume once the limit resets. When an orchestrator asks for a sub-agent on an exhausted account, it gets the reason back so it can pick another agent. An account that is only running low, or whose usage could not be checked, is never held back.

- [`f292a35`](https://github.com/warpforgehq/warpforge/commit/f292a3563f34fdfa14fb267348c9fc6772cc3264) Thanks [@ephor](https://github.com/ephor)! - On Linux, stopping or restarting a service no longer takes Warpforge down with it. Stopping a service now ends only that service and the processes it started, so the rest of your projects, agents and terminals keep running.

- [`c32421c`](https://github.com/warpforgehq/warpforge/commit/c32421c4566d7b94433b66118a2e4a253cc1aedb) Thanks [@ephor](https://github.com/ephor)! - Tasks in their own worktree now show their pull request. The sidebar row marks it open, draft, merged or closed, with a dot when checks are failing or still running, and the task header shows the number, state and checks — click it to open the pull request on GitHub. Status refreshes when you open a task or return to the app, and every few minutes while the pull request is open. Once it merges, **Archive and remove worktree** in the header or the row's menu files the task away and cleans up its worktree and branch in one step, after asking first. Requires the GitHub CLI signed in; without it nothing changes.

- [`fc9966a`](https://github.com/warpforgehq/warpforge/commit/fc9966a154be8991cf0d3114c7dc824810bff40d) Thanks [@ephor](https://github.com/ephor)! - Runtime now tells you when a service ignores the port Warpforge gave it. If a dev server is running but nothing answers on its assigned port, its row shows a warning such as "Listening on 4321, not 4400 — pass $PORT to its command, e.g. `--port $PORT`", and agents see the same warning when they list the runtime. Service commands can also use `${service.port}`directly, so`--port ${web.port}` just works.

- [`5ebed31`](https://github.com/warpforgehq/warpforge/commit/5ebed31dee0ee5ea180e7c4d3fb2bdc675b8bc8d) Thanks [@ephor](https://github.com/ephor)! - Isolated task copies are now cleaned up reliably, even after you restart Warpforge or update the app. Deleting a task removes its isolated copy and build files instead of leaving them behind, and a task that could not get its own copy now tells you why in "Needs you" rather than quietly running in your main checkout.

- [`d9f42df`](https://github.com/warpforgehq/warpforge/commit/d9f42dfd1405fc4efef2ceda78468f0ae067b93f) Thanks [@ephor](https://github.com/ephor)! - New task worktrees can now set themselves up. Add a `worktree:` section to your project's workspace config to copy files such as `.env` into every new worktree and to run a setup command there; if setup fails, the task stops with the reason and the worktree is kept. A new Worktrees tab on each project lists every worktree with its branch, owning task and disk size, lets you reclaim build folders like `node_modules` and `target`, and remove worktrees you no longer need. Removal always asks first and is refused while there is unsaved or unpushed work.

- [`c32421c`](https://github.com/warpforgehq/warpforge/commit/c32421c4566d7b94433b66118a2e4a253cc1aedb) Thanks [@ephor](https://github.com/ephor)! - Pick up work that already exists. In New Task, open the worktree's From chip and choose Existing branch or Pull request to check out a local or remote branch, or an open GitHub pull request (forks included), in a fresh worktree. When you push, the commits go back to that branch and update the pull request. A branch that is already checked out somewhere else is refused with a message saying where, and deleting the task leaves the branch in place.

- [`6242e07`](https://github.com/warpforgehq/warpforge/commit/6242e07180474f0e57975e13016849b3b4a8a0ff) Thanks [@ephor](https://github.com/ephor)! - Task copies now live inside the project's `.warpforge` folder instead of a root-level `.worktrees` directory, so they are kept with the project and never show up in `git status` or `git add .`. Your own `.gitignore` and `.git` are untouched. Tasks started by older versions keep their existing copies where they are.

- [`f8f93e3`](https://github.com/warpforgehq/warpforge/commit/f8f93e31b1b722bea16bdd5d30a17b584a1dc119) Thanks [@ephor](https://github.com/ephor)! - Agents working in an isolated worktree now know the running dev services belong to the main checkout, not their own, so restarting a service will not test their edits. Opening a task's Terminal tab starts the shell in that task's worktree.

- [`c32421c`](https://github.com/warpforgehq/warpforge/commit/c32421c4566d7b94433b66118a2e4a253cc1aedb) Thanks [@ephor](https://github.com/ephor)! - Choose where a worktree task starts. With Worktree on in New Task, the new From chip lets you branch off your current branch, any other local branch, or the latest from origin, fetched just before the task starts. The task remembers that base as the branch its work merges back into. Scheduled automations that run in a worktree can pick the same base, so a nightly job can always start from origin's latest.

- [`2f6cf05`](https://github.com/warpforgehq/warpforge/commit/2f6cf05d2175e7a701043890fb80266c2d538758) Thanks [@ephor](https://github.com/ephor)! - Task worktrees no longer show up as untracked files in your main checkout. Warpforge now keeps its `.worktrees/` folder out of `git status` automatically, so staging everything with `git add .` cannot pull in another task's checkout, and file search and the editor tree stay free of every task's copy.

## 0.21.1

### Patch Changes

- [`424ad8a`](https://github.com/warpforgehq/warpforge/commit/424ad8a56084049f56d5c3110dae16f02dc9e80e) Thanks [@ephor](https://github.com/ephor)! - OpenCode quota meters update again for accounts that sign in through the OpenCode console. OpenCode moved Go subscriptions to a console sign-in, so the usage figures could stop refreshing and show a 403 even while the plan was active; Warpforge now reads usage the same way the OpenCode app does and keeps showing the session, weekly and monthly windows.

## 0.21.0

### Minor Changes

- [#51](https://github.com/warpforgehq/warpforge/pull/51) [`d1daa7a`](https://github.com/warpforgehq/warpforge/commit/d1daa7ad07b1f1b5a761fc02cd852369458f0432) Thanks [@ephor](https://github.com/ephor)! - A task now has a Browser surface that works like a real browser — tabs, an address bar, back, forward and reload — so you can open docs, a dashboard, or the app you are building without leaving the workspace. Type a URL or a search and it goes; open as many tabs as you need. You stay signed in: log into a site once and the session is kept, so the next time you open the browser you are already there. Available in the desktop app.

### Patch Changes

- [#51](https://github.com/warpforgehq/warpforge/pull/51) [`9558307`](https://github.com/warpforgehq/warpforge/commit/9558307f02bac82a39f2624069276e06f3775028) Thanks [@ephor](https://github.com/ephor)! - The in-app browser now has a single address bar. The start page used to show its own search box on top of the toolbar's, which was confusing and only opened links; now typing anywhere goes through the one address bar at the top, and the cursor lands there automatically on a new tab.

- [#51](https://github.com/warpforgehq/warpforge/pull/51) [`d075e89`](https://github.com/warpforgehq/warpforge/commit/d075e8995f3075cdc343be720e7b66e3c7b15d95) Thanks [@ephor](https://github.com/ephor)! - The browser's new-tab page no longer looks empty and stranded when a project has no running services. It now shows a centered prompt to type a URL or start a service, and once services are running they appear centered as a tidy quick-link list.

## 0.20.2

### Patch Changes

- [`a49fa75`](https://github.com/warpforgehq/warpforge/commit/a49fa757ab2c89097c7f844b533f58f4e2a14c5f) Thanks [@ephor](https://github.com/ephor)! - An account card with a long harness name and several tags — "Claude Code · Work" with an outdated marker, a plan and the active mark — no longer breaks the name across three lines and runs off the card. The name stays on one line and shortens if it has to, and the tags sit on their own line underneath, where they wrap instead of squeezing the name.

- [`4ec4978`](https://github.com/warpforgehq/warpforge/commit/4ec497896af288c2a24d85d274b8b501a1d21036) Thanks [@ephor](https://github.com/ephor)! - The account picker is gone from Mission Control, Projects, Automations and every other view that has no agent in focus. It belonged to the work, not to the window chrome: a task now shows its own harness, account and remaining quota in its footer, and a view where no agent is running no longer offers a switch that would change an agent you are not using.

- [`1b768a0`](https://github.com/warpforgehq/warpforge/commit/1b768a00a3560664bb63baec4b8658b2e6a6dca1) Thanks [@ephor](https://github.com/ephor)! - The branch list answers the two questions you open it for. Your main branch leads the list instead of hiding behind the folder groups, since it is where everything branched from, and the branch you are on is marked at the end of its row with a check rather than with a mark in front of the name that pushed it out of line with every other branch. The list is set in the same type as the rest of the window instead of a code face, its rows are tighter, and the redundant "Branches" heading above "Local branches" is gone.

- [`7cbf822`](https://github.com/warpforgehq/warpforge/commit/7cbf8229b4decd13739dd24c45f4a499b66d5fd2) Thanks [@ephor](https://github.com/ephor)! - A pull request's changed files are grouped — migrations, implementation, tests, config, generated, documentation — and the diff's own file list now colours each group the way the overview already does, so the two readings of the same pull request agree at a glance instead of one of them flattening everything into grey.

- [`fa15455`](https://github.com/warpforgehq/warpforge/commit/fa154551842e7e8a4a41c605ef1eb1b46785b71b) Thanks [@ephor](https://github.com/ephor)! - "Files" said nothing about what the pane is for, and in a task it holds the project tree and the editor rather than a bare list of files. The pane is now called "Explorer" everywhere it appears — the task switcher, the project page, the panel heading and the toolbar button — so the name matches what you open it to do.

- [`1f5d02f`](https://github.com/warpforgehq/warpforge/commit/1f5d02f7baaecb907161b5941f802d28d2bd8cc6) Thanks [@ephor](https://github.com/ephor)! - Messages you send while an agent is still working now wait somewhere you can see them. They stack above the composer with their full text, instead of dropping into the chat as if the agent had already read them — a message joins the conversation at the moment the agent is actually handed it, so what you are reading is what the agent was told. Each waiting message then gets a turn of its own: the task shows running while the agent works on it and waiting only when the agent is really done, so a follow-up no longer leaves a busy session looking like it is your move. If you would rather not wait, "Send all now" stops what the agent is doing and hands it every waiting message at once, in the order you wrote them, so it acts on the whole correction instead of the first line of it; the half-finished answer it was writing is dropped rather than recorded as its reply. A scheduled run's prompt caught in the same queue keeps its own turn, so its result stays its own.

- [`c2a3c5b`](https://github.com/warpforgehq/warpforge/commit/c2a3c5bee5f1690f75e77eff3f9d5fa7ac1cbde3) Thanks [@ephor](https://github.com/ephor)! - A task's workspace is now switched from a single strip of icons that never goes away, instead of a row of tabs that disappeared whenever one half took the full width. The conversation, project tree, changes, runtime, terminal and pipeline are all one click apart whatever state the split is in, and the strip keeps showing which half is open — including the half you folded away. Each pane's header offers two plain actions, "make this full width" and "put it away", rather than a single toggle whose second meaning you had to discover; once a pane owns the screen, its restore control is drawn on that pane's own side of the split, so undoing it no longer means reaching into the other pane's header. Switching between surfaces slides a highlight between the icons, and hovering one names the surface and what it holds.

- [`cf7bf16`](https://github.com/warpforgehq/warpforge/commit/cf7bf16df6fb31398ab02c45b8377003f8e92dfe) Thanks [@ephor](https://github.com/ephor)! - How much of your plan each coding agent has left is now visible while you work in a task, not only inside the settings screen. The task's footer shows it against the agent the task actually runs on — a small bar and the remaining share for the rolling window and for the week, coloured as quota gets tight — with a refresh button beside it for when the numbers look stale, and the account menu one click away. The footer also says when the task runs in its own git worktree rather than your main checkout; the everyday case stays quiet so the row carries only what is worth reading.

## 0.20.1

### Patch Changes

- [`e155e90`](https://github.com/warpforgehq/warpforge/commit/e155e905ef9052bc23cac2588a9bf6a84d33e6bb) Thanks [@ephor](https://github.com/ephor)! - Every row in the sidebar tree now shares one left grid: the project row, its done-shelf and every task row put their expand arrow in the same column, the project's initial and a task's status mark on the next one, and their names on the one after that. The project row's hover highlight also covers its arrow instead of starting beside it.

## 0.20.0

### Minor Changes

- [`b211978`](https://github.com/warpforgehq/warpforge/commit/b21197898c0d086a329b39f74bffe9068b569efd) Thanks [@ephor](https://github.com/ephor)! - Editing and reviewing got their shortcuts and their bearings back. Quick Open (double Shift) and Find in Files (Cmd+Shift+F) now work on a project page, not just inside a task, and picking a hit lands in the right file at the right line. Clicking a file in the changes rail puts it at the top of the diff instead of somewhere in the middle, and large diffs no longer open on a blank band or lurch while the editors measure themselves. Tool output in the conversation reads as what it is — fenced code with its language, diffs with their changes tinted — and a group of agent work folds into one line with a summary you can open, including when a step failed. Edits made by any agent report their real line counts.

- [`b211978`](https://github.com/warpforgehq/warpforge/commit/b21197898c0d086a329b39f74bffe9068b569efd) Thanks [@ephor](https://github.com/ephor)! - The workspace remembers where you were, and pull requests moved into the sidebar. Reopen a task and the same file, cursor and scroll position are there; switch projects and your open tabs stay; a diff comes back on the same file and hunk with your folded files still folded. Flip the sidebar between Tasks and Inbox in place, come back to the task you were working in with one click, and see at a glance when an assistant review is running or waiting — including a count of what needs you. Projects open from the tree (the row shows an arrow on hover), and every project row shows what is inside without a second navigation stop.

- [`30e17f2`](https://github.com/warpforgehq/warpforge/commit/30e17f29818db6bfd543ab69271578c54922d479) Thanks [@ephor](https://github.com/ephor)! - Pull request changes are grouped by what they need from you — migrations, implementation, tests, configuration, generated files and documentation — so a review starts with the part that carries risk instead of scrolling one flat list. On the diff, the changed-files rail can switch between the folder tree and the same grouped view.

- [`c173b28`](https://github.com/warpforgehq/warpforge/commit/c173b2874dc9953dab489d4b5adc67f7376f2608) Thanks [@ephor](https://github.com/ephor)! - Copy what you need from a pull request without leaving it: its link, branch name, number, or a ready-to-paste Markdown title link. The actions hang off the pull request's own reference in the header, and the branch name has a copy button beside it on the overview.

- [`ec86b13`](https://github.com/warpforgehq/warpforge/commit/ec86b13e7e258587deca5675f8829f625ad62a16) Thanks [@ephor](https://github.com/ephor)! - A review now shows who it is waiting on, not only who has already answered: reviewers who have been asked but have not responded yet are listed with a request marker until they review.

### Patch Changes

- [`b211978`](https://github.com/warpforgehq/warpforge/commit/b21197898c0d086a329b39f74bffe9068b569efd) Thanks [@ephor](https://github.com/ephor)! - Messages you send to an agent that is still working now wait their turn instead of cutting the current one short. Previously a note typed mid-task could look like the task had ended, delivering a half-written answer as the result; the text now queues and runs as the agent's next turn, in order, while Stop remains the way to interrupt.

- [`b211978`](https://github.com/warpforgehq/warpforge/commit/b21197898c0d086a329b39f74bffe9068b569efd) Thanks [@ephor](https://github.com/ephor)! - Waiting looks like the work now. The conversation, pull request list, backlog, file editor, diffs, review panes and tracker images fill in place instead of flashing a spinner or a "Loading…" line, and empty screens offer the way out of being empty — an empty backlog offers to create its first item, an empty inbox offers to add a project. The chrome reads as one surface: a single type scale, visible seams, one focus ring, one tab look, and glass that covers the whole window rather than one pane.

- [`1757c06`](https://github.com/warpforgehq/warpforge/commit/1757c0608770301a838eabe5ff0d111c9be018dd) Thanks [@ephor](https://github.com/ephor)! - Creating, renaming and deleting files now work on a project page, not only inside a task — the file tree's New File, Rename and Delete are available wherever you are browsing files. Paths are still confined to the project they belong to.

## 0.19.3

### Patch Changes

- [`f61adab`](https://github.com/warpforgehq/warpforge/commit/f61adab9211a96ea1f4e7f8a54d5190f9f69aed1) Thanks [@ephor](https://github.com/ephor)! - Warpforge now keeps itself and your agents fresh without you asking. While the app is open it quietly checks for a new desktop release every few hours instead of only at launch, and it checks the AI agent programs you have installed twice a day. When an agent has an update waiting, a banner appears above Settings in the sidebar telling you how many agent updates are available; click it to jump straight to the Agents settings and install them.

- [`7f4e1a7`](https://github.com/warpforgehq/warpforge/commit/7f4e1a7cb81f3391d492178b979649a93b90446f) Thanks [@ephor](https://github.com/ephor)! - Side panels are now yours to size. Every rail — the workspace file tree, the changes list, a task's services and port-forwards, the run pipeline, the inbox list and a pull request's changed files — can be dragged to the width you want and remembers it, and collapsing one folds it away with a real animation instead of snapping out of the layout. The separators take the keyboard too: arrow keys nudge, Shift jumps, Home and End go to the bounds, Enter folds, and a double-click restores the default. The split inside a task works the same way: drag the seam between the conversation and the workspace and either side folds away to the edge once there is no room left for it, with a label over the pane that is about to go, so you can go full-screen on one of them without reaching for a menu. Squeezing the workspace also tucks the file tree, changes list or services rail out of the way on its own and brings it back when there is room again, so a narrow workspace shows the file you are reading instead of just its rail — the header button still opens the rail at any width if you want it there anyway. The conversation can also swap to the right of the workspace with the new flip control — it slides across — for anyone who reads the code on the left.

- [`4d37448`](https://github.com/warpforgehq/warpforge/commit/4d37448c60cc23598db897447956c98fcf0e2c57) Thanks [@ephor](https://github.com/ephor)! - Agents that maintain their own updates no longer show a permanent, unusable update prompt. Warpforge only compares an agent against the npm registry when it can actually install that update; an agent installed through its own updater could previously be flagged forever even though there was nothing to update from the Agents page.

- [`ced0cba`](https://github.com/warpforgehq/warpforge/commit/ced0cbac25ca8edd8d9228c2bb1b7350834bfc27) Thanks [@ephor](https://github.com/ephor)! - The app no longer freezes while a busy task streams output. Previously, when one view fell behind on updates it could stop Warpforge from handling anything else, so actions like opening the push dialog appeared to hang until that view caught up. Replies are now written ahead of pending updates, and a view that misses some resynchronizes itself with a fresh snapshot instead of staying stale.

## 0.19.2

### Patch Changes

- [`41c503c`](https://github.com/warpforgehq/warpforge/commit/41c503c7fc7c97b1e49a257c73d69f28c0428429) Thanks [@ephor](https://github.com/ephor)! - The code editor and the terminal work again in the installed app. Opening a file or a diff drew line numbers beside empty space — text turned up in the wrong font with its indentation gone, or only the tail of the file showed at all — and the terminal took neither a cursor nor a keystroke. Everything the editor, the diff viewer and the terminal style themselves with was being thrown away as the window loaded, so syntax colours, the monospace font and the whole line layout never arrived. This only ever affected released builds, which is why it could sit unnoticed while the app was run from source. The app also stops falling back to a slower channel for talking to its background service.

- [`6eb294f`](https://github.com/warpforgehq/warpforge/commit/6eb294f8a184549d69891738d26416e691b3a020) Thanks [@ephor](https://github.com/ephor)! - The agent actions on a pull request now say what they will do to you. **Explain** and **Review** answer inside the pull request and stay where they are. Everything that turns the change into a task on your board moved under **Send to agent**, which now also holds **Continue in a task** for handing the Assistant's own conversation a full window. Each choice spells out its consequence: "Starts a task on this branch to fix them, commit and push", "Moves the Assistant's conversation into its own task". Before this, six look-alike agent buttons sat side by side and nothing told you which one would take you off the pull request.

## 0.19.1

### Patch Changes

- [#49](https://github.com/warpforgehq/warpforge/pull/49) [`de89956`](https://github.com/warpforgehq/warpforge/commit/de899563c614603794b7216f8fda0b9e25fb9849) Thanks [@ephor](https://github.com/ephor)! - Harden the gh CLI shim: disable pagers via env, cache the resolved repo per invocation, spawn the query thread once, and pass issue bodies with `--body-file` to avoid arg-length limits.

- [#49](https://github.com/warpforgehq/warpforge/pull/49) [`c113067`](https://github.com/warpforgehq/warpforge/commit/c113067809d821bdc10b256e686aef4a28c35e7d) Thanks [@ephor](https://github.com/ephor)! - Review your GitHub pull requests without leaving the app. A new Inbox in the sidebar collects open pull requests across every project, with an unread count that lights up when a PR you follow gets new activity — in the same amber Mission Control uses for work waiting on you, so it reads as "something moved" rather than as another total; each project page gains a Pull Requests tab listing its own. Pick a PR from the list and the review opens beside it at full width — press `j`/`k` to move through the list without leaving the diff.

  Each review has three tabs. **Overview** reads like a document: the description, then every review and comment as a card underneath it, with a rail beside them for status, reviewers, branch and the changed files — grouped into implementation and documentation so you can see at a glance how much of a change is code and how much is prose. Click any file to jump straight to its diff — the whole list is there, scrolling in place with its group headings pinned, and nothing to click open first. The description and the rail scroll separately, so reading one never moves the other. **Diff** is the code itself: switch between unified and side-by-side, filter or browse files as a folder tree, tick files off as you read them, and comment on any line by hovering its line number. Review threads appear on the lines they were written about, replies land on GitHub straight away, and you can approve or request changes from the tab bar. Review bodies from bots now render their callouts and collapsible sections properly instead of showing raw markup.

  **Send to agent** now asks what you want done rather than handing an agent a bare link: _Address review comments_ passes every unresolved remark with its file and line, _Work on this branch_ passes the description and the files it touches, and both start by checking out the pull request's own branch. **Assistant** puts an agent on the pull request. Press **Explain** for a walk through the change — what it does, how the new flow works, and a diagram when the shape is easier to see than to read — or **Review** for a critical pass: risks, missing tests and review comments you can post. Both continue the same conversation, so you can ask follow-ups, and it survives closing the app: reopen the PR and the thread is where you left it. Pick which agent and which model answers from the tab's header — your choice is remembered per harness. "Continue in task" moves the thread into a full task view when you want the whole window. These conversations stay inside the pull request — they never clutter your board or backlog — and they clean themselves up once the PR is merged or closed.

  Big changes can be read one commit at a time: open **Commits** on the Diff tab and tick the commit you want, or tick two to read the run between them — the diff, the file list and the viewed marks all follow your selection, and "All commits" puts the whole change back. Switching between commits you have already opened is instant. Very large pull requests stay usable too: a ten-thousand-line change opens, scrolls and switches between unified and side-by-side without the pane stalling, because only the part of the diff you are actually looking at gets drawn. One consequence worth knowing: your browser's find-in-page only searches the files currently on screen, so use the file list to get to the right file first.

  Status checks aren't shown yet. `[` and `]` step through files, and both rails collapse when you want the whole window for the diff.

  Requires a GitHub connection (Settings → Trackers); `gh` CLI still works as a fallback.

## 0.19.0

### Minor Changes

- [`fdb92ae`](https://github.com/warpforgehq/warpforge/commit/fdb92ae4f1427c0b9757dc6969789e9086a57cf3) Thanks [@ephor](https://github.com/ephor)! - Add native glass transparency with Appearance controls. Turn on the frosted-glass look and tune Glass opacity and blur radius, or extend the effect across the whole window with body glass, from Settings → Appearance.

## 0.18.0

### Minor Changes

- [`2405cf6`](https://github.com/warpforgehq/warpforge/commit/2405cf68021c28979cef0392080367e46c966565) Thanks [@ephor](https://github.com/ephor)! - The Changes panel now shows the whole picture of your working copy. Files you have edited stay under "Changes", brand-new files that git isn't tracking yet get their own "Unversioned Files" group instead of hiding among them, and the eye button reveals everything your .gitignore covers when you need to check on a build output or a local config file. Projects that contain more than one checkout get a node per repository, each labelled with its own branch, so it is clear which repository a change belongs to before you commit it.

- [`1efe1d5`](https://github.com/warpforgehq/warpforge/commit/1efe1d510c6ec70f9dd834bb7e73e4f4e33407d4) Thanks [@ephor](https://github.com/ephor)! - You can now clear a project's "done" shelf in one click instead of deleting finished tasks one at a time. Hover the shelf and click the trash icon; it asks you to confirm first, showing exactly how many will go and how many are being kept because their worktree still holds uncommitted changes worth reviewing.

- [`37b4b1f`](https://github.com/warpforgehq/warpforge/commit/37b4b1fa3685ef366da65d74b9ca368d5d258151) Thanks [@ephor](https://github.com/ephor)! - The Changes rail grows Shelf and Stash tabs. Shelve any file or folder with an auto-generated or AI-drafted name, preview shelved bundles, and unshelve them back; git stash entries list with per-file preview, apply/pop, single-file restore, and drop. Destructive actions (apply-and-drop, delete) ask for confirmation showing exactly which files are involved.

### Patch Changes

- [`f898ecf`](https://github.com/warpforgehq/warpforge/commit/f898ecfa0212e7fafd95f3b49122066a7f27f407) Thanks [@ephor](https://github.com/ephor)! - Tasks you mark handled now actually free the space their conversations used. Until now only tasks that finished on their own counted as closed, so anything you closed yourself kept its full transcript forever — invisible in the sidebar but still on disk, which is what made Warpforge slow down and grow over time. The retention window in Settings → Tasks now applies to them too, and counts from the day you closed the task rather than the last time anything touched it.

## 0.17.0

### Minor Changes

- [`15aa428`](https://github.com/warpforgehq/warpforge/commit/15aa4288fda82d3fbba558c90c01c2000d98e87c) Thanks [@ephor](https://github.com/ephor)! - Attach text files to chat prompts, not just images. Click the paperclip in the composer (or drag and drop, or paste) to add markdown, code, configs, CSV and any other text file — the full content reaches the agent, so it can answer questions about the file instead of guessing. Images keep working as before, and you can mix files and images in one message.

- [`8982d69`](https://github.com/warpforgehq/warpforge/commit/8982d69f5cbba7c3f5729f7c1090cfdd987a54e9) Thanks [@ephor](https://github.com/ephor)! - Settings has been redesigned. Pick a category on the left — Appearance, Agents, Integrations, Tasks, Memory, Advanced — instead of scrolling one long page, and each setting says what it does in a line. Your agent logins now show the quota they have left, right on the account.

  Chat scrolling is fixed. Scroll up while an agent is answering and you stay there instead of being dragged back to the newest message, and pasting a long log no longer freezes the window.

## 0.16.0

### Minor Changes

- [#47](https://github.com/warpforgehq/warpforge/pull/47) [`03b8dae`](https://github.com/warpforgehq/warpforge/commit/03b8daef0d13fea204aff5f858bf44f49798e32b) Thanks [@ephor](https://github.com/ephor)! - Automations: schedule a prompt to run on a project with the agent and model you
  pick — hourly, daily, weekdays, weekly, or any cron expression in your own time
  zone. Each run is a real task you can open from Mission Control, with an
  optional precheck gate (skip the run when a check fails), a reuse-session mode
  that keeps one ongoing conversation per automation, and a per-automation
  missed-run grace window so a laptop that slept for a week does not fire a
  week-old job on wake. Run history per automation shows what happened, when, and
  why anything was skipped. Agents can manage automations through the automation
  MCP tools.

### Patch Changes

- [#48](https://github.com/warpforgehq/warpforge/pull/48) [`74fcdea`](https://github.com/warpforgehq/warpforge/commit/74fcdea040119d354eb0951ab9179fccddd35758) Thanks [@ephor](https://github.com/ephor)! - Scheduled automation runs now tell the agent they are scheduled. Every run
  starts with a short line naming the automation and its run number and saying
  the turn is unattended, so the agent delivers the result instead of asking a
  clarifying question nobody is there to answer. This matters most for
  automations set to reuse the same task every run, where the identical prompt
  used to arrive in one conversation over and over and read as a person repeating
  themselves. Your prompt is passed through unchanged underneath, and it no
  longer has to explain that the run is automated.

- [#46](https://github.com/warpforgehq/warpforge/pull/46) [`6cd1944`](https://github.com/warpforgehq/warpforge/commit/6cd19446a1f57ddb20201677db31fec8e9508178) Thanks [@BatrakM](https://github.com/BatrakM)! - The language server list in Settings now loads in the installed app instead of spinning forever. Version checks are also bounded: a server that stops responding shows up as "not found" or without a version rather than holding up the whole list, and it no longer leaves stray processes running in the background. If a request to the workspace ever does go unanswered, the app now tells you instead of leaving a spinner on screen.

## 0.15.0

### Minor Changes

- [`993728e`](https://github.com/warpforgehq/warpforge/commit/993728e71f3c83508d9e02e51398b5c2dfa4ac55) Thanks [@ephor](https://github.com/ephor)! - Pin the exact ports your team's services run on — and commit them to the repo.

  Declare a port range in a project's config (`ports.range: "4200-4299"`), and every service in that project that declares a port now binds exactly that port. No more "port 3000 actually means 4000-something": if a pinned port is taken, the service fails loudly and tells you why, instead of silently moving. Services that prefer the old behaviour can opt back in with `portFallback: auto`.

  Ranges are assigned per project and stick for good — adding or removing a project no longer shuffles everyone else's ports, and two machines that declare the same range in the config now agree on the same ports. If two projects claim the same range, one of them refuses to start services until the conflict is resolved. A declared port that sits outside the project's range fails loudly too, with both ways out named in the error: move the port inside the range, or set `portFallback: auto`.

  One thing to know going in: a service's declared port used to be ignored — any free port in the project's range was used and passed to the app as `PORT`. In a project that declares a range it is now the exact port the service must bind, so if your app doesn't read `PORT` (hardcoded port instead), tell it the port via the environment or a `--port $PORT` flag in its command, or it will end up listening somewhere Warpforge isn't looking.

- [`993728e`](https://github.com/warpforgehq/warpforge/commit/993728e71f3c83508d9e02e51398b5c2dfa4ac55) Thanks [@ephor](https://github.com/ephor)! - See where a project's port range comes from — and fix conflicts on your machine only.

  Each project now shows whether its port range was declared in the team's shared config, set as a local override on your machine, or assigned automatically. When two projects claim the same range, the affected project says so up front and names the other project, with a one-field fix that applies to your machine only — the team's shared config is never edited from here. An existing local override can be cleared just as easily, and the badge stays visible the whole time so a machine-only range can't silently outrank the config. Pinned service ports are marked in the runtime view, with a reminder that a pinned port fails rather than moves when it's already taken.

## 0.14.0

### Minor Changes

- [`06c639a`](https://github.com/warpforgehq/warpforge/commit/06c639a2cb321ac71d90e571b9e09cefdc8cf429) Thanks [@ephor](https://github.com/ephor)! - See how much of each coding agent's quota is left before you run out mid-task. The task header now shows your session and weekly usage at a glance, and clicking it opens every agent you are signed into — Claude, Codex and OpenCode — with how much is left on each, when the limit resets, and what the work would have cost at API rates. When one login is spent you can see which of your others still has room and switch to it right there, without leaving the task. The same breakdown lives in Settings.

### Patch Changes

- [`873cd9f`](https://github.com/warpforgehq/warpforge/commit/873cd9ff4a1e8a4918ab39c72d33f1fd38db4f5d) Thanks [@ephor](https://github.com/ephor)! - Apps now start fast again on big workspaces. Connecting no longer loads every conversation up front; a chat loads its own full history the moment you open it, with a brief loading state until it appears in one piece. The "Needs you" badge now stays accurate right after startup, even before a conversation has streamed anything.

## 0.13.0

### Minor Changes

- [`5f5464a`](https://github.com/warpforgehq/warpforge/commit/5f5464ad12bec27b286853db98385c5dede7f0db) Thanks [@ephor](https://github.com/ephor)! - Faster cold start and automatic history cleanup. The app now loads only a small recent slice of each task's chat on connect, so starting after a while no longer hangs on a large database. Closed tasks keep their chat for 30 days, waiting tasks with no changes settle themselves after 2 weeks, and untouched closed tasks are removed after 90 days. Each step is visible with a notice, and all three windows are adjustable in Settings → Task history.

## 0.12.1

### Patch Changes

- [`ef18638`](https://github.com/warpforgehq/warpforge/commit/ef186383d8df36c518bcdc9cbd6c6bd1a66d4379) Thanks [@ephor](https://github.com/ephor)! - Pick up a conversation an agent can no longer resume. When an agent forgets its
  session — its own history expired or was cleaned up — the task used to sit
  blocked on a protocol error with nowhere to go. Warpforge keeps its own
  transcript, so now a banner offers to carry on: either hand the new session the
  whole conversation, or have it summarised into a handoff document first, with an
  estimate of what each option costs in context. You choose which harness and
  account writes that summary, which helps when the one you were using is out of
  quota.

  The same choice is available from "Continue with…" on any message, and handing a
  conversation to another agent no longer forces a separate worktree — keep it in
  the checkout you are already working in, and Warpforge remembers the choice.

- [`f1ec44e`](https://github.com/warpforgehq/warpforge/commit/f1ec44e3a18e517d9f0955da9ec6495f53e7819a) Thanks [@ephor](https://github.com/ephor)! - The model you pick for a task is now the model that runs it. Warpforge remembers
  your choice for the whole task, re-applies it whenever a session reconnects, and
  tells you when an agent refuses it instead of quietly falling back to its own
  default — a banner in the session and an entry in the "Needs you" rail name the
  model that was requested and why it did not take.

  The New Task picker no longer says "Default" when it will actually reuse the
  model you last chose; it shows which one you will inherit. And when you ask an
  agent to start a sub-agent on a specific model, it can look up the models that
  agent really offers and pick a valid one, instead of guessing a name that
  silently does nothing.

- [`24239db`](https://github.com/warpforgehq/warpforge/commit/24239db182ac63fcf31d0de33dac211b49d05b0f) Thanks [@ephor](https://github.com/ephor)! - Show nested git repositories properly in the Files tree. Folders containing
  their own git repo (or newly created, still-untracked folders) used to render
  as plain file rows and could not be expanded; their contents are now listed.

- [`0350a31`](https://github.com/warpforgehq/warpforge/commit/0350a3118dfacf2d5fa1002d48e359d496e81d6c) Thanks [@ephor](https://github.com/ephor)! - Reconnect notices no longer clutter the conversation. "Reconnecting to the saved
  agent session" now appears as a passing status with a spinner and disappears
  once the agent replies, rather than staying in the transcript forever, and the
  "Agent is waiting for the next instruction" line is gone — the composer already
  tells you that.

- [`408d20a`](https://github.com/warpforgehq/warpforge/commit/408d20ad78edeb3f55e141b64bd58bee622178a9) Thanks [@ephor](https://github.com/ephor)! - Session cost now reads as money. It is shown to the cent with a decimal point,
  so a few dollars no longer looks like a few thousand on machines where the
  comma is the decimal separator.

## 0.12.0

### Minor Changes

- [`4d7cf06`](https://github.com/warpforgehq/warpforge/commit/4d7cf0676cc8e7acb3be1a580524c183f1beea1b) Thanks [@ephor](https://github.com/ephor)! - Add Elixir syntax highlighting and IntelliSense in the editor, backed by elixir-ls/Lexical

### Patch Changes

- [`0cb5adb`](https://github.com/warpforgehq/warpforge/commit/0cb5adbb68f93d87c302b9fdf7c33ffcdc1c2832) Thanks [@ephor](https://github.com/ephor)! - Move line number next to filename in Go to Definition popup

- [`dbd03fd`](https://github.com/warpforgehq/warpforge/commit/dbd03fd0574eaa3f934e1d5a840d615889a535ce) Thanks [@ephor](https://github.com/ephor)! - Improve Go to Definition accuracy, ranking, and popup behavior

- [`e85401b`](https://github.com/warpforgehq/warpforge/commit/e85401ba13b45db814196f46f762c5a1ed69e9e4) Thanks [@ephor](https://github.com/ephor)! - Enable IntelliSense when browsing project files, not just task workspaces

## 0.11.1

### Patch Changes

- [`b653d60`](https://github.com/warpforgehq/warpforge/commit/b653d60cfe3c74d4244030c6ae937841a80c2458) Thanks [@ephor](https://github.com/ephor)! - Long chats no longer shimmer while an agent streams. The transcript used to
  slide and fidget as messages grew, especially in sessions with hundreds of
  rows: unmeasured rows drifted, and expanding or collapsing a group of tool
  results would yank the viewport off what you were reading.

  The transcript list now keeps its visible position anchored to the conversation
  edge instead of re-measuring everything on every token. Streaming text settles
  in place, and folding a work group keeps the toggle under your cursor instead
  of chasing the latest message. We also ported the upstream LegendList anchoring
  patch (and bumped `@legendapp/list` to 3.3.5) so the scroll engine can actually
  hold the end steady while content streams in.

- [`b399131`](https://github.com/warpforgehq/warpforge/commit/b399131728868edf7f6f7f4e1447cbc9a067cba4) Thanks [@ephor](https://github.com/ephor)! - Long chats no longer pin you to the bottom. Following the live edge used to
  re-engage across a huge window in a long session, so the instant you tried to
  scroll up it snapped you back down — you had to flick hard to break free. It
  now only follows when you are genuinely at the last message (a small pixel
  band), so reading back through a long transcript feels free again.

  Your own messages are also easier to spot. User bubbles are now rounder,
  pillowed, and right-aligned, so they read as you speaking instead of blending
  in with the flat tool-activity cards sitting beside them.

## 0.11.0

### Minor Changes

- [`fc10039`](https://github.com/warpforgehq/warpforge/commit/fc10039df85848b9f2bc4921664a44fbd581e3d0) Thanks [@ephor](https://github.com/ephor)! - GitHub backlog now prefers a PAT (`repo` + `read:project`) stored in keychain (Settings → Trackers), with `gh` CLI as deprecated fallback for backlog only (PR creation still uses `gh`). Sync reconciles remote status, removes deleted issues, surfaces missing-scope warnings via toast, and no longer blocks the daemon (parallel checks, 30s global timeout, immediate spinner).

### Patch Changes

- [`82f63d2`](https://github.com/warpforgehq/warpforge/commit/82f63d2aaae260762bd323ca078cddae412b30d4) Thanks [@ephor](https://github.com/ephor)! - The agent's session pickers (model, effort, and the "More" overflow) now close
  when you click anywhere else — in the composer textarea, the editor, or any
  other part of the app — instead of staying open until you click the trigger
  again. Opening one picker also dismisses the one you had open, so several can't
  stay open at once. The model picker keeps focus in its search box when it opens
  so you can start filtering right away.

- [`e4e744d`](https://github.com/warpforgehq/warpforge/commit/e4e744d3929534dd873ff86bf525558793ba917b) Thanks [@ephor](https://github.com/ephor)! - Project Files is now editable: the sidebar's file tree opens any checkout file
  in a write-enabled editor (⌘S to save), with `file.save` and `git.commit`
  addressed by project name when no task owns the file. Project files picked from
  the tree also open with the same WebStorm-style change gutter as task files —
  thin colored bars for added (green) and modified (blue) lines, a marker for
  deleted lines, and a click-to-revert / per-file commit popup.

- [`c8f12da`](https://github.com/warpforgehq/warpforge/commit/c8f12dae837165dfb08790a2ad488817344b75f3) Thanks [@ephor](https://github.com/ephor)! - Fix ghost backlog rows after deleting a task linked to a tracker item. Deleting a task now clears `backlog_items.task_id` / `tracker_links.task_id` and YAML `task_id` refs, resets status to `todo`, and invalidates the backlog query. The board only shows "Open task" when the task still exists.

- [`c8f12da`](https://github.com/warpforgehq/warpforge/commit/c8f12dae837165dfb08790a2ad488817344b75f3) Thanks [@ephor](https://github.com/ephor)! - Discovered follow-up work can now be saved directly to the local backlog as a
  todo item without starting an agent. The new `create_backlog_task` action
  supports a title, details, priority, and status; the older `create_task` name
  continues to work as a deprecated compatibility alias.

- [`26353aa`](https://github.com/warpforgehq/warpforge/commit/26353aa62d7aaec37766b0ab21dfa81f0ccd49a9) Thanks [@ephor](https://github.com/ephor)! - In the unified diff view, clicking a "changed lines" marker in a chat message
  now scrolls the editor to the matching change instead of leaving you to hunt
  for it. The move to a single CodeMirror editor had dropped that jump; it is
  restored via the editor's own scroll, so the changed rows (which CodeMirror's
  diff already tints) land in the center of the pane.

- [`afb8355`](https://github.com/warpforgehq/warpforge/commit/afb8355a4bd6363cda6d9735be78f8cb49101b2c) Thanks [@ephor](https://github.com/ephor)! - Dropdowns, menus, tooltips, and dialogs no longer make the button you clicked
  flicker. Opening a filter on the backlog board, switching between two
  dropdowns, or moving the mouse off a tooltip used to flash the control for a
  moment; now only the panel itself fades in and out, so clicking through filters
  stays calm.

- [`d6752c9`](https://github.com/warpforgehq/warpforge/commit/d6752c99f795a124863030bf038f6e6bbfc4d0ca) Thanks [@ephor](https://github.com/ephor)! - Dropdowns and context menus now read at the same size as the rest of the app
  instead of standing out — an open list of options or a task's "..." menu was
  noticeably larger than the rows behind it. Options sit tighter, and hovering
  one gives you a pointer cursor so it looks as clickable as it is.

- [`5dc8b5a`](https://github.com/warpforgehq/warpforge/commit/5dc8b5ac43805850f102fb66cba8090030466610) Thanks [@ephor](https://github.com/ephor)! - The desktop app now builds on Tailwind CSS v4, replacing the v3 PostCSS
  pipeline with the dedicated Vite plugin. The theme (colors, radii, fonts, and
  animations) moved into a single CSS `@theme` block, and the shadcn enter/exit
  animations are defined as native CSS keyframes instead of a plugin. The app's
  unified-diff and markdown surfaces now use the shadcn `typeset` typography
  system, giving chat and preview text a consistent, container-aware rhythm that
  follows the selected color theme.

- [`2c90796`](https://github.com/warpforgehq/warpforge/commit/2c907967bd79ecb30484ade34fe4ba4e6f0a6ae8) Thanks [@ephor](https://github.com/ephor)! - Rendered markdown now uses the shadcn `typeset` style system. Chat messages get
  a tight `typeset-chat` rhythm and the editor's markdown preview a roomier
  `typeset-docs` one, so headings, lists, code, and links read consistently and
  follow the active color theme. This replaces the old `prose` classes, which
  depended on a typography plugin the app did not ship.

- [`b38e771`](https://github.com/warpforgehq/warpforge/commit/b38e7719831f91abd6dee95c9c897fe4618d9373) Thanks [@ephor](https://github.com/ephor)! - The demo iframe on the marketing page now loads the desktop app's own
  stylesheet directly. The app's Tailwind v4 entry is self-contained (it scans
  its own source for classes), so the separate `app-theme.css` that used to point
  at the app's old v3 config is gone.

## 0.10.3

### Patch Changes

- [#44](https://github.com/warpforgehq/warpforge/pull/44) [`90e8f7a`](https://github.com/warpforgehq/warpforge/commit/90e8f7a4a8402f698029bb50a430fecc1cbcc983) Thanks [@ephor](https://github.com/ephor)! - The documentation site now wears the same wordmark as the app and the front page, instead of the site title in plain text.

- [#43](https://github.com/warpforgehq/warpforge/pull/43) [`630c234`](https://github.com/warpforgehq/warpforge/commit/630c234eed2fcaa8c42c9e497da119dcbd9fbc80) Thanks [@ephor](https://github.com/ephor)! - Warpforge has a documentation site. It covers the whole product rather than the quick start: installing it, bringing your own agents and running several logins for each, everything agents can do on your behalf, memory they share across harnesses, choosing between a single agent, an orchestrator and a workflow, writing workflows of your own, the day-to-day craft of working inside a task, the git surface, and a page for every setting.

  Its front page opens with Warpforge itself running rather than a screenshot: a real task plays through — a Claude lead handing the test suite to Codex, edits stacking up into a diff you can read line by line, a file tree and a terminal you can click into — and you can view the whole thing in any of the eight themes.

- [#43](https://github.com/warpforgehq/warpforge/pull/43) [`630c234`](https://github.com/warpforgehq/warpforge/commit/630c234eed2fcaa8c42c9e497da119dcbd9fbc80) Thanks [@ephor](https://github.com/ephor)! - The YAML backlog now writes to `.warpforge/backlog` in your project, alongside every other Warpforge file, instead of a misspelled `.workforge` directory. If you already have items under the old name, move that folder across once and they will be picked up.

- [#43](https://github.com/warpforgehq/warpforge/pull/43) [`630c234`](https://github.com/warpforgehq/warpforge/commit/630c234eed2fcaa8c42c9e497da119dcbd9fbc80) Thanks [@ephor](https://github.com/ephor)! - HTML previews in the editor now run their scripts, so an interactive prototype an agent just built behaves like one — click it instead of reading its markup. The preview stays isolated: it keeps its own origin and cannot reach anything else in Warpforge, submit forms, open popups, or navigate the app.

- [#43](https://github.com/warpforgehq/warpforge/pull/43) [`630c234`](https://github.com/warpforgehq/warpforge/commit/630c234eed2fcaa8c42c9e497da119dcbd9fbc80) Thanks [@ephor](https://github.com/ephor)! - Links to the project's source now point at its new home, `warpforgehq/warpforge` — in the app's changelog link, the docs, and the update feed the desktop app checks.

- [`38c2f43`](https://github.com/warpforgehq/warpforge/commit/38c2f43a2a3f512cd1507898dd19d562f731da69) Thanks [@ephor](https://github.com/ephor)! - Unified diff now uses CodeMirror's `unifiedMergeView` instead of the custom `<pre>` renderer, so wrapping tracks the container width, syntax highlighting and collapsed-unchanged handling match the split view, and backgrounds no longer clip on long lines.

## 0.10.2

### Patch Changes

- [#41](https://github.com/ephor/warpforge/pull/41) [`1f6909a`](https://github.com/ephor/warpforge/commit/1f6909a80c28efdb485d6ae25a95d85f89451912) Thanks [@lapa2112](https://github.com/lapa2112)! - Items you own can be deleted from their details panel, with a confirmation first — useful for the note you jotted down and no longer need. Issues that came from a tracker have no delete here: closing one belongs in the tracker it lives in, and a row removed on this side would return on the next sync.

- [#41](https://github.com/ephor/warpforge/pull/41) [`bc1bb6e`](https://github.com/ephor/warpforge/commit/bc1bb6e8e61ef1f916906bc4dfe43baf3547e521) Thanks [@lapa2112](https://github.com/lapa2112)! - Work items can carry a description again. The new-item dialog has a description field under the title — markdown, growing as you type — and on items you own the description is editable from the details panel: hover it and click the pencil, or start one on an item that has none. Escape backs out of an edit without closing the panel. Descriptions on issues that came from a tracker stay read-only, since the tracker is where they are written.

- [#41](https://github.com/ephor/warpforge/pull/41) [`27f16d0`](https://github.com/ephor/warpforge/commit/27f16d076c5dc31bbf650115c4c209a683a3c733) Thanks [@lapa2112](https://github.com/lapa2112)! - Items you own can be renamed from their details panel: click the title, type, and press Enter — Escape backs out. Emptying the field leaves the old title in place rather than saving a nameless row. Titles on issues that came from a tracker stay read-only, as their descriptions already do.

- [#41](https://github.com/ephor/warpforge/pull/41) [`f0dbe8f`](https://github.com/ephor/warpforge/commit/f0dbe8fabd15df60170cda8eaf06f5602c328a71) Thanks [@lapa2112](https://github.com/lapa2112)! - Backlog items now reflect what your tracker actually says. GitHub issues take their status from your project board — Todo, In Progress, In Test, Done — instead of every item reading "To do", and the board's own wording shows on the item's details. Created and Updated are the issue's real dates, so an item no longer looks like it was created the moment Warpforge first saw it, and Linear issues arrive with the person they are assigned to instead of showing as unassigned. Items imported earlier are corrected on the next sync; hit Sync in the backlog toolbar to refresh straight away. Board statuses come from your GitHub CLI sign-in, and items fall back to open/closed if it cannot see your projects.

- [#41](https://github.com/ephor/warpforge/pull/41) [`6e9e9d7`](https://github.com/ephor/warpforge/commit/6e9e9d77a237a165463a3b768c787cb61d80085e) Thanks [@lapa2112](https://github.com/lapa2112)! - Filtering the backlog by yourself now shows your own notes too. Items you create are put on you by default and can be reassigned or unassigned from the item's details, so they sit alongside the tracker issues assigned to you instead of dropping out of the view. The backlog also remembers how you left each project — filters and sort order survive switching projects and restarting — while the search box starts empty each time.

- [#41](https://github.com/ephor/warpforge/pull/41) [`c4d9ea9`](https://github.com/ephor/warpforge/commit/c4d9ea93a88ca413b5de979b4c6b08e286a51e4c) Thanks [@lapa2112](https://github.com/lapa2112)! - Warpforge now actually asks before doing something you cannot take back. Deleting a task, quitting while services are running, closing a half-written work item, and switching memory search to the downloadable model all went ahead silently — the prompt they relied on never appeared. Each one now shows a real dialog naming what is about to happen, with the failure reported instead of passing for success.

## 0.10.1

### Patch Changes

- [`2899b89`](https://github.com/ephor/warpforge/commit/2899b895ef4b8a3193b983a70518244e72c8eee1) Thanks [@ephor](https://github.com/ephor)! - Fix memory for agents: saving no longer fails after deleting a memory, and search now finds notes by tags and partial terms instead of returning empty results. Existing databases migrate automatically.

## 0.10.0

### Minor Changes

- [#40](https://github.com/ephor/warpforge/pull/40) [`f7c27a3`](https://github.com/ephor/warpforge/commit/f7c27a359c92188f4530c3890f4d79a41f90d521) Thanks [@ephor](https://github.com/ephor)! - Cross-harness memory for agents: one durable `~/.warpforge/memory.db` (global + per-project overlay) shared across Claude, Codex, opencode. FTS5 with optional vector hybrid (fastembed MiniLM-L6-v2 + vec0, RRF fusion, cosine). 8 MCP tools (`memory_store/search/list/update/delete`, `memory_edges/addEdge`, `memory_dream`, `memory_list/resolve_compaction`) so any harness can read/write the same store. Dreaming pass finds stale/duplicate/contradiction proposals (heuristic + code-aware LLM prompt), writes to `memory_compaction_log` for human approve/reject — manual Dream button in Settings or idle/cron background. Settings now shows per-scope stats and pending compaction count.

### Patch Changes

- [#39](https://github.com/ephor/warpforge/pull/39) [`d8fa4fe`](https://github.com/ephor/warpforge/commit/d8fa4fe3fcc51be2bc397803ff7c3c359bc26bca) Thanks [@ephor](https://github.com/ephor)! - Cap unbounded agent text merging and gate Live strip work behind its tab to reduce memory pressure and GC churn in Mission Control.

## 0.9.0

### Minor Changes

- [#38](https://github.com/ephor/warpforge/pull/38) [`24c0e62`](https://github.com/ephor/warpforge/commit/24c0e623790228f59005d5c3da1ec495d9022558) Thanks [@ephor](https://github.com/ephor)! - Redesigned Mission Control around four tabs — Live, Needs you, Failed and Pinned — with full-width Live rows, inline queue actions and a remembered active tab for faster triage. Restored the missing create_task MCP tool wiring.

## 0.8.0

### Minor Changes

- [#37](https://github.com/ephor/warpforge/pull/37) [`44d0494`](https://github.com/ephor/warpforge/commit/44d04945da009178fc0dd7db8db75133eb222b7e) Thanks [@ephor](https://github.com/ephor)! - Runtime shows a project's services and port-forwards in one place, with their live logs and the `http://localhost:…` address of anything that is up. A row carries its status and its name, and start, restart and stop appear on it when you point at it; starting or stopping everything at once is a single click in the Services or Port Forwards heading. Whatever you have selected is named in the toolbar itself, so the logs get the height instead. The side panels in Runtime and in the diff view fold away when you want the room.

- [#37](https://github.com/ephor/warpforge/pull/37) [`44d0494`](https://github.com/ephor/warpforge/commit/44d04945da009178fc0dd7db8db75133eb222b7e) Thanks [@ephor](https://github.com/ephor)! - Every project now has a backlog, and it can be fed straight from your issue tracker. Connect GitHub — Warpforge uses the `gh` CLI session you already have — or Linear with a personal API key, which is kept in your OS keychain. A project's open issues are imported when you open it and refresh on Sync. A Linear key is account-wide, so each project picks the Linear team it reads; until you pick one, that project imports nothing from Linear. New work items are created the same way whether they stay local or land in GitHub or Linear — the destination is just a chip on the form.

  The list loads more as you scroll, and each row reads across one line: title, status, priority, tracker, assignee and when it last changed. Search titles and bodies, filter by status, priority, tracker or assignee — your own account is offered first, since most of the time you are looking for your own work — and pick the sort order from the toolbar. Clicking a row opens its details beside the list instead of taking you elsewhere: the full description with any screenshots from the issue shown inline, assignee, timestamps, and a link straight to the issue. Priority is editable there, and so is status for items you wrote yourself; issues that came from a tracker show the tracker's own status, since that is where it is decided. Start task turns an item into an agent task and links the two, so the row offers Open task from then on. Escape or a click outside puts you back exactly where you were in the list.

- [#37](https://github.com/ephor/warpforge/pull/37) [`44d0494`](https://github.com/ephor/warpforge/commit/44d04945da009178fc0dd7db8db75133eb222b7e) Thanks [@ephor](https://github.com/ephor)! - A project opens into tabs, the same way a task does: Backlog, Files, Runtime and Terminal. Files browses the project's own checkout without starting a task — pick anything in the tree and it opens in a syntax-highlighted, read-only preview, with several files open at once across a tab strip. Runtime gets the whole screen for the project's services and port-forwards, and Terminal is a tab of its own beside it. Each project remembers the tab you left it on, and its name, path, port range and New work item stay pinned above them all.

### Patch Changes

- [`cc907fc`](https://github.com/ephor/warpforge/commit/cc907fc5eec374bc29c73223a0c9b9bbde461bb9) Thanks [@ephor](https://github.com/ephor)! - An open task now says which project it belongs to. The breadcrumb above it starts with the project's name instead of the app's, so switching between tasks from different projects no longer leaves you guessing which checkout you are looking at.

- [#37](https://github.com/ephor/warpforge/pull/37) [`44d0494`](https://github.com/ephor/warpforge/commit/44d04945da009178fc0dd7db8db75133eb222b7e) Thanks [@ephor](https://github.com/ephor)! - Surfaces across the app now agree with each other. The terminal and the Runtime panel sit on the same background as every other pane instead of their own shade, list rows highlight across their full width, and screenshots pasted into an issue render as pictures rather than raw markup.

## 0.7.0

### Minor Changes

- [`ce453d4`](https://github.com/ephor/warpforge/commit/ce453d40b2f68d96c6c059254f40e48f32f141ea) Thanks [@ephor](https://github.com/ephor)! - Search a whole project without leaving the task. Press ⌘⇧F (Ctrl ⇧ F) to open Find
  in Files: type anything and see every matching line grouped by file, with a live
  peek at the code around the highlighted hit. Enter opens the file right at that
  line, centered in the editor with the cursor already there, ready to type. The
  quick-open palette (double ⇧ Shift or ⌘P) now finds text too — matching source
  lines appear under the file names and jump straight to the line you picked, with a
  spinner while the search runs. Both palettes close on Escape from anywhere, or on a
  click outside, so an accidental open is never a trap.

### Patch Changes

- [`1b3503d`](https://github.com/ephor/warpforge/commit/1b3503defba03e4924752c223829e26e54d21350) Thanks [@ephor](https://github.com/ephor)! - New versions are now impossible to miss. When an update is available, a bright
  button appears in the top bar naming the version — one click downloads it, and a
  second one restarts Warpforge to finish. Progress and any failure stay on that same
  button, so the update never quietly stalls out of sight. The updates panel is still
  there for release notes and manual checks.

- [`9491bfd`](https://github.com/ephor/warpforge/commit/9491bfda05c80863e18d7f5d71d78ca0fe930f4b) Thanks [@ephor](https://github.com/ephor)! - Warpforge can now be installed with a single Homebrew command:
  `brew install --cask ephor/tap/warpforge`. The cask installs the same signed,
  notarized build as the DMG, and the built-in updater stays in charge of
  updates afterwards — Homebrew only handles the initial install.

- [`abb14af`](https://github.com/ephor/warpforge/commit/abb14af9c14836fac22afadbbd3d08e4df5ba43d) Thanks [@ephor](https://github.com/ephor)! - Project search now keeps up with your typing. Searching a mid-sized repository used
  to take seconds and stall while results trickled in; it now finishes in a fraction
  of that, so Find in Files and the quick-open palette respond as you type. Searches
  also stay on the files that belong to the project — build output, dependencies and
  other ignored files no longer bury the results you want.

## 0.6.8

### Patch Changes

- [`b6c5c64`](https://github.com/ephor/warpforge/commit/b6c5c64552bdec13a988edf899ed8fb53327919d) Thanks [@ephor](https://github.com/ephor)! - Connect Warpforge's service tools to your terminal agent once, and they follow you
  between projects. Previously a hand-configured connection had to name a single
  project up front, so an agent started in any other repository read the wrong
  runtime — or refused to start at all. Now the project is picked from the folder
  the agent runs in, including task worktrees, so one setup covers every project you
  have registered. Agents launched from Warpforge itself are unchanged.

- [`94f0a8a`](https://github.com/ephor/warpforge/commit/94f0a8a61804458512ace9bb20592f8490956df0) Thanks [@ephor](https://github.com/ephor)! - Service log timestamps now say they are UTC. Outside the UTC zone the bare
  timestamp read as a clock that had fallen hours behind, so a healthy service
  looked stalled; the lines now end in `Z`.

## 0.6.7

### Patch Changes

- [#35](https://github.com/ephor/warpforge/pull/35) [`65df616`](https://github.com/ephor/warpforge/commit/65df616be0d21d6dc907d513768fa75d841290bf) Thanks [@ephor](https://github.com/ephor)! - MCP tool names no longer show as raw `mcp__server__tool` strings in the
  transcript, permission prompts, or notifications. `mcp__warpforge__list_runtime`
  now renders as "Warpforge · List runtime".

  The orchestrator's `spawn_agent` title now surfaces who is being spawned and on
  what ("Spawn agent codex: Refactor the auth module") immediately, so a
  sub-agent dispatch is visible without expanding the tool.

- [#35](https://github.com/ephor/warpforge/pull/35) [`6a2e3e7`](https://github.com/ephor/warpforge/commit/6a2e3e7a17e415e55e10a7b1423d8bc825c0d5b5) Thanks [@ephor](https://github.com/ephor)! - Log reading tools now behave like `kubectl --timestamps | grep | tail`: every line
  carries a UTC timestamp, `filter` runs over the whole retained buffer before the
  newest `limit` are kept, and a new `context` option adds surrounding lines around
  each match (`grep -C`).

  Log cursors are now stable sequence numbers instead of buffer indexes. Each line
  gets a monotonic `seq`; `after` is inclusive of that seq and the response returns
  `nextSeq`, so polling for new lines is nearly free even as the ring buffer drops
  old ones. `logSeq` in `list_runtime` is the live cursor.

  Service lifecycle is now visible in the log stream: `[service running]`,
  `[service stopped]`, and `[service failed: exit code=N]` markers are injected on
  state transitions, so a restarting process no longer looks like empty logs.

- [#36](https://github.com/ephor/warpforge/pull/36) [`6ea2bcb`](https://github.com/ephor/warpforge/commit/6ea2bcb2516f563f296c082c588c83e117b69371) Thanks [@ephor](https://github.com/ephor)! - Very long conversations stay where you left them. Sending a message or watching
  an agent reply keeps the chat pinned to the newest message instead of drifting
  up into older history, and the chat now only stops following a reply when you
  actually scroll up — clicking a file link or expanding work updates leaves it
  pinned. Scroll back down to the newest message and it starts following again on
  its own.

- [#35](https://github.com/ephor/warpforge/pull/35) [`e19ef2b`](https://github.com/ephor/warpforge/commit/e19ef2b75cf145f55df277fecc8038c552993723) Thanks [@ephor](https://github.com/ephor)! - Agents working on a task can now inspect and control the project's running services on their own. They can read live service and port-forward logs, search them for errors, and start, stop, or restart a service without you copying logs into the chat by hand — the agent checks the runtime itself whenever it needs to.

## 0.6.6

### Patch Changes

- [`768c175`](https://github.com/ephor/warpforge/commit/768c1754f3629d015e3b50beaded2a35f857201e) Thanks [@ephor](https://github.com/ephor)! - Add html files preview in editor.

- [`7c997a4`](https://github.com/ephor/warpforge/commit/7c997a4697722f7a331672c097bb6cc7987be401) Thanks [@ephor](https://github.com/ephor)! - Native notifications now work. When an agent needs your approval, or a task
  wants attention while Warpforge is in the background, macOS shows a notification
  with Approve, Reject and Review buttons — and those buttons now do what they
  say, so you can answer a permission request without switching back to the app.
  Notifications stay quiet while Warpforge is the window you are looking at, so
  the in-app toast remains the only interruption when you are already there.

## 0.6.5

### Patch Changes

- [`0c75c45`](https://github.com/ephor/warpforge/commit/0c75c45d212b3490bc99cbff39510b5ff90af76a) Thanks [@ephor](https://github.com/ephor)! - Fixes the whole UI freezing after closing a dialog. Creating a project, opening settings, or any other modal could leave the page unclickable and text unselectable until restart.

  The freeze came from Radix shipping several copies of `@radix-ui/react-dismissable-layer` with different versions, each keeping its own lock on the page body. When a dialog and a dropdown or selector overlapped, the copies fought over the body's pointer-events and one of them never let go. Bumping the Radix packages and pinning `@radix-ui/react-dismissable-layer` to a single version so only one copy ships, removing the conflict at the root.

## 0.6.4

### Patch Changes

- [#34](https://github.com/ephor/warpforge/pull/34) [`c18d59d`](https://github.com/ephor/warpforge/commit/c18d59d577b4fe9bbf7012455530181de199e575) Thanks [@ephor](https://github.com/ephor)! - Amending a commit now starts from the message you already wrote. Tick amend in the Changes rail and the box fills with the commit you're rewriting, ready to edit or leave as it is — handy when you just forgot a file. Anything you had already typed is kept, and amending without touching the message no longer refuses to commit.

- [#34](https://github.com/ephor/warpforge/pull/34) [`c18d59d`](https://github.com/ephor/warpforge/commit/c18d59d577b4fe9bbf7012455530181de199e575) Thanks [@ephor](https://github.com/ephor)! - Model lists now keep up with your agents. Add a provider or model in the agent itself and Warpforge picks it up next time it starts — or right away with the refresh button next to the agent in Settings, which also shows how many models it currently knows about. Switching model or reasoning effort mid-conversation now shows your pick immediately and tells you if the agent turned it down, instead of leaving you guessing whether the click landed.

- [#34](https://github.com/ephor/warpforge/pull/34) [`c18d59d`](https://github.com/ephor/warpforge/commit/c18d59d577b4fe9bbf7012455530181de199e575) Thanks [@ephor](https://github.com/ephor)! - Long model lists are now searchable. Open the model picker in the composer and a search box sits pinned at the top of the list — type to narrow hundreds of models down to the one you want, clear it with the × button, and press Esc to close. Selectors with only a handful of choices stay as simple lists, so nothing extra gets in the way when you just need to switch reasoning effort.

- [#34](https://github.com/ephor/warpforge/pull/34) [`c18d59d`](https://github.com/ephor/warpforge/commit/c18d59d577b4fe9bbf7012455530181de199e575) Thanks [@ephor](https://github.com/ephor)! - Failures in the Changes rail now arrive as a notification with the reason instead of a block of text wedged under the commit box, and long output — a rejected pre-commit hook, say — comes with a Copy button for the full log. When an agent turns down a request, such as drafting a commit message, the message now includes the reason the agent gave, which is usually enough to tell a wrong model or a missing login from a real failure.

- [`024451f`](https://github.com/ephor/warpforge/commit/024451fae1d1dec2e1758e1379da832c6a818b58) Thanks [@ephor](https://github.com/ephor)! - The model picker no longer closes itself a moment after you open it. Searching a long model list now works the same everywhere Warpforge runs, instead of the menu disappearing before you finish typing.

## 0.6.3

### Patch Changes

- [`11b28da`](https://github.com/ephor/warpforge/commit/11b28dae4871b6af325c400cfbaf8a729b59eb70) Thanks [@ephor](https://github.com/ephor)! - The desktop agent setup now detects and can install more coding agents: Cursor, Pi, and Junie. Pick any of them in the setup wizard just like the existing agents — the daemon finds, installs, and keeps each one updated for you.

## 0.6.2

### Patch Changes

- [#33](https://github.com/ephor/warpforge/pull/33) [`c50688f`](https://github.com/ephor/warpforge/commit/c50688f34eb33269d6e9129fde94552be9996776) Thanks [@ephor](https://github.com/ephor)! - A workflow no longer ends for good when one of its agents is lost. If an agent
  process dies part-way through a stage — killed by something outside the run,
  not by anything wrong with the work — the pipeline now pauses at that stage
  instead of finishing as failed. Press Resume and it runs the stage again,
  warned that the working copy may already hold partial changes. Previously the
  run was over: resume was refused and the only way forward was a new task, even
  when the work was already done.

- [#33](https://github.com/ephor/warpforge/pull/33) [`98f58ea`](https://github.com/ephor/warpforge/commit/98f58eabbc9404d3d1ef77e14ca2014c50688802) Thanks [@ephor](https://github.com/ephor)! - Starting a task no longer pauses while its name is written. Naming a task runs
  a short agent in the background, and the app used to wait on it before handling
  anything else — so the first message, tool approvals, and other tasks all sat
  still until the name came back. Naming now happens alongside your work, as do
  installing an agent or a language server, which had the same problem and could
  hold things up for much longer.

- [#33](https://github.com/ephor/warpforge/pull/33) [`9689d81`](https://github.com/ephor/warpforge/commit/9689d813956d2a40bb28d29afc24d310765f31c3) Thanks [@ephor](https://github.com/ephor)! - The app now handles several requests at once instead of one at a time. A single
  slow action — listing a large project, loading a diff, scanning for agents —
  used to hold up everything else you did, so a tool approval could sit waiting
  until the slow one finished. Requests that only read now run alongside each
  other, and replies are sent without waiting on the network's send delay, which
  takes tens of milliseconds off routine actions.

- [#33](https://github.com/ephor/warpforge/pull/33) [`364e5b8`](https://github.com/ephor/warpforge/commit/364e5b8df3d7e16f95e716db6dc7bf195c7c8b67) Thanks [@ephor](https://github.com/ephor)! - Starting a task in its own workspace copy no longer holds up everything else.
  Setting that copy up takes a moment, and until now the whole app waited on it —
  your other tasks' replies and approvals paused until the new task's workspace
  was ready. The task now shows up on the board immediately and begins work as
  soon as its workspace lands, while the rest of the app keeps moving.

- [#33](https://github.com/ephor/warpforge/pull/33) [`c387c6f`](https://github.com/ephor/warpforge/commit/c387c6f27c79f7632d72001543e4b9f6583a2769) Thanks [@ephor](https://github.com/ephor)! - Branching a conversation now carries your uncommitted work across, including
  when the original task runs in the project folder itself rather than its own
  workspace copy. The branch used to start from the last commit in that case, so
  edits you had not committed were missing from the conversation meant to
  continue them.

- [#33](https://github.com/ephor/warpforge/pull/33) [`b05f44d`](https://github.com/ephor/warpforge/commit/b05f44d799811cd0a5db1936e99a1445743d446a) Thanks [@ephor](https://github.com/ephor)! - Searching for files no longer freezes the rest of the app. On a large project
  the search reads through every file, and until now everything else — agent
  replies, approvals, service controls — stopped until it finished. Search now
  runs out of the way, so the app keeps responding while it works.

- [#33](https://github.com/ephor/warpforge/pull/33) [`c41e691`](https://github.com/ephor/warpforge/commit/c41e6916efcdba8112c475500f1528974ed74a91) Thanks [@ephor](https://github.com/ephor)! - Merging a task's workspace copy back into your project no longer pauses the
  rest of the app while git works.

- [#33](https://github.com/ephor/warpforge/pull/33) [`22ba126`](https://github.com/ephor/warpforge/commit/22ba1269967fd05faab9005f0ef02236c08cdbc7) Thanks [@ephor](https://github.com/ephor)! - Approving a tool call, sending a message, or starting a task no longer waits on
  whatever else is happening. Previously, while an agent was streaming its answer,
  the app saved every fragment as it arrived and everything else queued up behind
  that — so an approval prompt could sit unresponsive for as long as the agent
  kept typing, even in a different task. Saving now happens out of the way, and
  the interface stays responsive while agents work.

- [#33](https://github.com/ephor/warpforge/pull/33) [`f73592d`](https://github.com/ephor/warpforge/commit/f73592dc7f3ba4c0f3145e4e2931708ae6a4b224) Thanks [@ephor](https://github.com/ephor)! - Long conversations no longer grow memory without limit. The app used to keep
  every line of everything your agents had said in memory and reload it all on
  start, so the more work agents did, the more memory the app held onto even when
  it was only showing the latest exchange. It now keeps just what the current
  view needs — the latest message and the most recent exchange — and loads the
  rest only when you resume a session or open a project. Resuming a session
  still shows each reply once, and nothing in the chat history is lost.

- [#33](https://github.com/ephor/warpforge/pull/33) [`1e5b63e`](https://github.com/ephor/warpforge/commit/1e5b63e92a5898e453dcef6455a2aeb18cce5ffd) Thanks [@ephor](https://github.com/ephor)! - Warpforge no longer stops processes it did not start. When shutting down it used
  to clear everything listening on the project's port range, which could take down
  a server you were running yourself — or, when running warpforge's own tests, the
  agents of the warpforge you were running them from. It now only stops the
  services it started.

- [#33](https://github.com/ephor/warpforge/pull/33) [`4227053`](https://github.com/ephor/warpforge/commit/4227053779c1b9bd082fd56eca0451edbae199b4) Thanks [@ephor](https://github.com/ephor)! - Viewing changes no longer slows the rest of the app down. The changes panel
  refreshes on a timer, and each refresh used to hold everything else up while it
  inspected the repository — with a task open, that was a steady drip of pauses
  affecting agent replies and approvals. Reading diffs, file contents, file lists
  and branches now happens alongside the rest of the app instead of in front of
  it.

- [#33](https://github.com/ephor/warpforge/pull/33) [`ec03690`](https://github.com/ephor/warpforge/commit/ec03690aa18f3636c4931dad97a75d8607f57576) Thanks [@ephor](https://github.com/ephor)! - Committing, pushing, merging, switching branches, saving a file and opening a
  pull request no longer pause the rest of the app while they run. Each of these
  waits on git, and until now everything else — agent replies, approvals, your
  other tasks — waited with it. They now run alongside your work, so a slow push
  costs you the push and nothing else.

## 0.6.1

### Patch Changes

- [`05dbe4c`](https://github.com/ephor/warpforge/commit/05dbe4cf7ad60d60cc1a532c8cae0b0080b1afb7) Thanks [@ephor](https://github.com/ephor)! - IntelliSense is now one install away. When a language server is missing—say you open a `.ts`, `.py`, or `.rs` file and the server isn't on your machine—the editor shows a one-click **Install** banner instead of silently falling back to plain syntax highlighting. Install (or update) any supported language server from **Settings → Language servers**, where each language shows its status: installed, update available, or not found, with a single button to fix it. Warpforge picks the right package manager for your setup (npm, bun, pnpm, or Homebrew) and refreshes the editor automatically once the server is ready, so completion, diagnostics, hover, and go-to-definition just start working.

## 0.6.0

### Minor Changes

- [`feb128b`](https://github.com/ephor/warpforge/commit/feb128b59848f13a033c6a60497f03ff30cf0d3b) Thanks [@ephor](https://github.com/ephor)! - Code editor selections now offer a floating "Send to chat" action (and a
  Cmd/Ctrl+L shortcut) that drops the selected lines into the task chat as a file
  reference. The popover sits below a single-line selection so it no longer covers
  the selected text. Also fixes the editor's focused-selection flash on dark
  themes, where CodeMirror's built-in light rule painted near-white over text — the
  selection tint now always follows the app theme.

## 0.5.0

### Minor Changes

- [#32](https://github.com/ephor/warpforge/pull/32) [`956a6af`](https://github.com/ephor/warpforge/commit/956a6afde0e86396851e12ae1aacf09863226507) Thanks [@ephor](https://github.com/ephor)! - Code editing in Warpforge just got a major upgrade. The editor now brings intelligent language support into your workspace: jump from any symbol to its definition with Cmd/Ctrl-click or Cmd+B, see errors and warnings directly in your code, inspect documentation on hover, get completions as you type, find references, rename symbols, and format code. Double-Shift or Cmd/Ctrl+P opens any project file instantly, making large codebases much faster to navigate. Your work stays under your control too: edits are saved only when you explicitly press Save or Cmd/Ctrl+S.

### Patch Changes

- [#31](https://github.com/ephor/warpforge/pull/31) [`eceb85d`](https://github.com/ephor/warpforge/commit/eceb85dccbf11d8f34b9e698365aee39a72adb8e) Thanks [@ephor](https://github.com/ephor)! - Branch Delete now force-deletes (`git branch -D`, equivalent), so deleting an
  unmerged local branch from the branch-switcher context menu no longer fails
  with "not fully merged". The dialog already confirms the action is
  irreversible, matching the force semantics.

- [#31](https://github.com/ephor/warpforge/pull/31) [`65ed890`](https://github.com/ephor/warpforge/commit/65ed8906e6c3017fc1f2383e055158b3eaa04566) Thanks [@ephor](https://github.com/ephor)! - Branch actions now open as a detached dark submenu beside the branch row,
  rather than expanding the branch list vertically. Branch names are action
  triggers instead of implicit checkouts, and the submenu keeps its position
  clear while preserving the IDE-style branch actions.

- [#27](https://github.com/ephor/warpforge/pull/27) [`8498f21`](https://github.com/ephor/warpforge/commit/8498f21a614fb2ff8cdb030fca5db344fcea957b) Thanks [@ephor](https://github.com/ephor)! - Add a "View changelog" link to the desktop update dialog that opens the repository changelog in the browser.

- [#31](https://github.com/ephor/warpforge/pull/31) [`0cd394c`](https://github.com/ephor/warpforge/commit/0cd394c48281f2b31115e4674110075f48a6b3e1) Thanks [@ephor](https://github.com/ephor)! - File listing, reading, saving, and filesystem actions now resolve task
  worktrees before falling back to the project checkout. This keeps Project
  Files, diff state, editor writes, Finder actions, and delete/rename/create
  operations pointed at the same working copy.

- [#31](https://github.com/ephor/warpforge/pull/31) [`5c027d6`](https://github.com/ephor/warpforge/commit/5c027d61fceb75eb932bc1bfc74b2795910109a0) Thanks [@ephor](https://github.com/ephor)! - Expand native file context menus:

  - Project Files: Open, Copy Path, Reveal in Finder, Open in Default App, and
    Refresh.
  - Changes rail: Show Diff, Jump to Source, Stage/Unstage, Rollback File, Copy
    Path, and Refresh.

- [#31](https://github.com/ephor/warpforge/pull/31) [`13524d5`](https://github.com/ephor/warpforge/commit/13524d5e4cad999bed9f9149fb5a751c08c1e896) Thanks [@ephor](https://github.com/ephor)! - Project Files now removes physically deleted tracked files from its listing.
  The file list explicitly refetches after filesystem mutations instead of only
  marking the query stale.

- [#31](https://github.com/ephor/warpforge/pull/31) [`08c6acb`](https://github.com/ephor/warpforge/commit/08c6acb92a905ce13d25fddda4651e90c6ffec49) Thanks [@ephor](https://github.com/ephor)! - Project Files now supports real filesystem actions from its native context
  menu: New File, New Folder, Rename, and Delete. Operations are daemon-backed,
  validate relative paths, refresh the tree after success, and require an
  explicit dialog confirmation for deletes.

- [#31](https://github.com/ephor/warpforge/pull/31) [`a0bff5f`](https://github.com/ephor/warpforge/commit/a0bff5fcf914f9b7941f0b6a402c70eec4ddf801) Thanks [@ephor](https://github.com/ephor)! - Add a global `New Branch…` action to the branch dropdown. It creates a branch
  from the current branch and checks it out after creation, while branch-specific
  `New Branch from…` actions remain available in each branch submenu.

- [#31](https://github.com/ephor/warpforge/pull/31) [`5fed599`](https://github.com/ephor/warpforge/commit/5fed599222e80c2c6ec4d4b0c8fb762377d2e998) Thanks [@ephor](https://github.com/ephor)! - More native right-click menus, extending the context-menu foundation to the rest of the desktop surfaces:

  - **Project files panel** — right-click a file for Open or Copy Path; right-click a folder to Expand/Collapse or Copy Path.
  - **Chat transcript** — right-click any user or assistant message to Copy it as plain text.

  Infra unchanged: all three surfaces reuse the existing Tauri `show_context_menu` command and `useNativeContextMenu` hook.

- [#31](https://github.com/ephor/warpforge/pull/31) [`400efbe`](https://github.com/ephor/warpforge/commit/400efbe99ae34a3a3a8848d7d1dce3e090d86b66) Thanks [@ephor](https://github.com/ephor)! - Native OS context menus now back the two main git surfaces, so the desktop app finally feels like an IDE:

  - **Changes rail** — right-click a changed file/folder for Stage/Unstage, Open in Diff, and Copy Path.
  - **Branch switcher** — right-click any branch for Rename Branch…, Delete Branch… (non-checked-out only), Rebase Onto…, and Merge Branch Into…, each via a small dialog. New daemon ops: `git.branchRename`, `git.branchDelete`, `git.rebase`, `git.merge`, all rollback-safe (stash/abort/restore on conflict) like the existing `git.switchBranch`.

  Reusable infra underneath: a Tauri `show_context_menu` command + `useNativeContextMenu` hook for wiring future right-click menus.

- [#31](https://github.com/ephor/warpforge/pull/31) [`97ae62c`](https://github.com/ephor/warpforge/commit/97ae62c6d328afcbd9e563cb8fa7ac0c3fd7e141) Thanks [@ephor](https://github.com/ephor)! - New Branch now includes Checkout branch and Override existing branch options.
  Branch names that already exist on a remote are highlighted and require the
  override option before creation. The daemon honors both options.

- [#29](https://github.com/ephor/warpforge/pull/29) [`bd4b384`](https://github.com/ephor/warpforge/commit/bd4b384ffca4782c7628796876ff55ae775dd09a) Thanks [@ephor](https://github.com/ephor)! - Task rows in the sidebar now expose Archive and Delete from their overflow menu, matching the action menu inside a task's detail view — so a task can be archived or removed without opening it first.

- [#31](https://github.com/ephor/warpforge/pull/31) [`26aec23`](https://github.com/ephor/warpforge/commit/26aec233696f7ff0411ba6aad92075c1092b89f6) Thanks [@ephor](https://github.com/ephor)! - Rebase actions now update the selected branch without checking it out first,
  matching WebStorm's `Rebase '<branch>' onto '<target>'` behavior. The daemon
  uses `git rebase --onto ... ... <branch>` and restores the current working tree.

- [#31](https://github.com/ephor/warpforge/pull/31) [`b0190d9`](https://github.com/ephor/warpforge/commit/b0190d99d765001e09f86250b11e106bf7c7fddc) Thanks [@ephor](https://github.com/ephor)! - Remote branch submenus now expose supported integration actions: rebase the
  current branch onto a remote ref, merge a remote ref into the current branch,
  and pull using either rebase or merge. Remote branches remain non-checkout
  rows; checkout-as-local is still available separately.

- [#31](https://github.com/ephor/warpforge/pull/31) [`c85f7a6`](https://github.com/ephor/warpforge/commit/c85f7a685f95e5fb4c912953bbb6dbfb186243ba) Thanks [@ephor](https://github.com/ephor)! - Remove the non-functional branch "Compare or Show Diff with" action and its
  unused daemon RPC. Branch menus now only expose supported operations.

- [#31](https://github.com/ephor/warpforge/pull/31) [`647796d`](https://github.com/ephor/warpforge/commit/647796dc1b98491b2f7797313158bf6192c0d8f9) Thanks [@ephor](https://github.com/ephor)! - Rollback and git operations (commit, update, switch, branch, rebase, merge)
  now run against the task's worktree instead of the project root, so changes
  are applied where the diff is shown.

- [#31](https://github.com/ephor/warpforge/pull/31) [`a77ace9`](https://github.com/ephor/warpforge/commit/a77ace91eb01fdcd7a1f3d8808d05d281f968aa7) Thanks [@ephor](https://github.com/ephor)! - Show remote-tracking branches correctly in the branch tree. Git can emit the
  remote name itself (for example `origin`) alongside `origin/main`; the branch
  list now filters that namespace marker so remote branches are not hidden.

- [#30](https://github.com/ephor/warpforge/pull/30) [`fa829f0`](https://github.com/ephor/warpforge/commit/fa829f079a849470394b27d282c9deab6de6d22e) Thanks [@ephor](https://github.com/ephor)! - TheoMod, a Settings easter egg (Socket → Settings → Fun): blurs email addresses everywhere they render — agent account chips, the account switches on the Claude/Codex bar, and the Accounts panel. Hover (or focus) un-blurs; copy still returns the real address.

- [#31](https://github.com/ephor/warpforge/pull/31) [`38cddb8`](https://github.com/ephor/warpforge/commit/38cddb8c076334615836ffbe58e89f863a38d833) Thanks [@ephor](https://github.com/ephor)! - Rework the branch switcher into an IDE-style tree: local and remote branches
  are separated, slash-prefixed names form expandable folders, and each branch
  has a visible actions button. Branch actions now include checkout, creating a
  branch from a ref, checkout-and-rebase/update, compare stats, update, push,
  rename, delete, rebase, and merge.

## 0.4.2

### Patch Changes

- [`4710b8b`](https://github.com/ephor/warpforge/commit/4710b8b553381afbf246bfbca20948459d1b1237) Thanks [@ephor](https://github.com/ephor)! - Theme system for the desktop app: four workspaces of palettes (warm neutral, light/dark pairs) with a theme picker in Settings. Editor syntax highlighting now draws from each theme's own token palette instead of fetching a fixed editor theme, and agent logos get light/dark variants so they read on both modes.

## 0.4.1

### Patch Changes

- [`cf34477`](https://github.com/ephor/warpforge/commit/cf34477b063338cf8ac3b60a55fec2083766da5e) Thanks [@ephor](https://github.com/ephor)! - Fixed a bug that prevented dragging images into the chat composer's dropzone. Screenshots can now be dropped directly instead of saving them and using the image button.

- [`30ba568`](https://github.com/ephor/warpforge/commit/30ba5680dcb0d52d96cc763486c3ed4dcfc9ee9a) Thanks [@ephor](https://github.com/ephor)! - Rebuilt the New Task screen around the prompt. The run context (project, harness, model, worktree, services) now sits as one quiet strip inside the composer instead of five bordered cards, and a diagram under it draws what Start will actually do — the selected pipeline's real stages and review rounds, or an example split for an orchestrator.

  Changing the project no longer wipes your harness, model picks or the prompt you already typed; only the pipeline is dropped, because pipelines belong to a project. Switching modes no longer shifts the page around, and the pipeline menu is more compact, with the "save an editable copy into this project" action on the same row as each pipeline.

- [`30ba568`](https://github.com/ephor/warpforge/commit/30ba5680dcb0d52d96cc763486c3ed4dcfc9ee9a) Thanks [@ephor](https://github.com/ephor)! - New Task now remembers whether you start tasks in an isolated git worktree. The toggle stays off by default, but once you turn it on it stays on for the next task instead of resetting every time.

## 0.4.0

### Minor Changes

- [#26](https://github.com/ephor/warpforge/pull/26) [`2cc28d9`](https://github.com/ephor/warpforge/commit/2cc28d93d289f854265d6c5380682fd67e02541f) Thanks [@ephor](https://github.com/ephor)! - The desktop app has a new design. Navigation now lives in a persistent sidebar that lists your projects, their tasks and each task's subtasks, ordered so whatever you are working in stays on top; finished work moves behind a quiet "done" shelf instead of filling the tree. Opening a task shows the conversation beside one surface at a time — Files, Diff, Runtime or Pipeline — rather than several panels competing for the same space, and Pipeline now streams a child agent's live transcript so you can watch what it is doing without leaving the parent conversation.

  Task statuses are simpler: "idle" and "needs review" were the same thing — the agent finished, it is your turn — and are now a single "waiting" state, with a changed-file count telling you whether there is a diff to open. Mission Control's queue lists only work that genuinely cannot move without you, so its count means something again. The Board view is gone; the sidebar and Mission Control cover what it showed.

  The theme moves to a warm near-black with a peach accent, and status colours are kept distinct from it.

### Patch Changes

- [#24](https://github.com/ephor/warpforge/pull/24) [`56732f9`](https://github.com/ephor/warpforge/commit/56732f9f14ee6876cfdf35651d02abfe0c301b1d) Thanks [@ephor](https://github.com/ephor)! - Orchestrators can now dispatch a full plan/implement/review/fix workflow pipeline as a sub-agent (`spawn_workflow`), not just single agents. The pipeline's progress and final result show up through the same `list_agents` / `read_inbox` tools as a regular sub-agent, and `answer_workflow` / `decide_workflow` / `pause_workflow` / `resume_workflow` let the orchestrator respond to a pipeline's questions and review-limit decisions without derailing it.

## 0.3.3

### Patch Changes

- [#23](https://github.com/ephor/warpforge/pull/23) [`aa74c5d`](https://github.com/ephor/warpforge/commit/aa74c5dc8662efae75fd3d6f8ad17ddf84bda92d) Thanks [@ephor](https://github.com/ephor)! - Fix Codex refusing to start once an account was selected. Each account now keeps
  its own Codex databases instead of sharing the ones in `~/.codex`, which failed
  with "failed to initialize sqlite state runtime" and left every Codex task
  unusable until the account was removed. Config, skills and session history are
  still shared, so an account sees the same setup as a plain `codex` run.

  Conversations also resume in the home they were started in. A chat older than
  the accounts feature stays on your original login rather than being sent to
  whichever account happens to be active, and a new chat keeps the account it
  started on even after you switch.

## 0.3.2

### Patch Changes

- [#22](https://github.com/ephor/warpforge/pull/22) [`57baf2d`](https://github.com/ephor/warpforge/commit/57baf2dddcf680c39cc166609475f6ede312bcb6) Thanks [@ephor](https://github.com/ephor)! - Keep the desktop app light when a project has large build directories. The file
  tree and mention picker no longer list `node_modules`, `target`, `dist`, `.next`
  or `.git` at any depth — on a Rust + Node project that is 162,000 entries down
  to under 1,000 — while other `.gitignore`'d files such as `.env` stay listed and
  openable. Mission Control session tiles also stop refetching a project's file
  list on every task update, so their data is reused instead of rebuilt.

- [#22](https://github.com/ephor/warpforge/pull/22) [`f93391f`](https://github.com/ephor/warpforge/commit/f93391ffbdef8ed368113d56f9b8add557677000) Thanks [@ephor](https://github.com/ephor)! - Run several agent accounts and switch between them without logging in again.
  Register each login you already use from Settings → Accounts, then pick the
  active one from the chip in the header. Switching a Claude account applies to
  running sessions on their next request; Codex sessions keep the account they
  started with until restarted.

## 0.3.1

### Patch Changes

- [`208c4ec`](https://github.com/ephor/warpforge/commit/208c4ec438554502c243a76954be4eff01b739bb) Thanks [@ephor](https://github.com/ephor)! - Orchestrators can now list their sub-agents, stop individual sessions without
  losing their history, and permanently clean up completed sessions in bulk.
  Active sessions are protected by default, and cleanup can be previewed before
  anything is removed.

- [`f8cd422`](https://github.com/ephor/warpforge/commit/f8cd422c1e767a9b836854a060c32188df1b23d3) Thanks [@ephor](https://github.com/ephor)! - Keep the task agent picker within the available viewport and make long agent lists scrollable.

- [`def2ec8`](https://github.com/ephor/warpforge/commit/def2ec83d4efd412bce82ef850059dc2499b161f) Thanks [@ephor](https://github.com/ephor)! - Chat rendering is now identical between MissionControl and TaskDetail views
  by extracting a shared SessionChat component with LegendList virtualization,
  work-group toggles, MessageActions overlay, and unified composer routing.

- [`81105f4`](https://github.com/ephor/warpforge/commit/81105f4626391a58b7d9b6aba671a48b683fda0c) Thanks [@ephor](https://github.com/ephor)! - Remove focus mode from Mission Control pinned tiles. The feature hid other tiles and disabled grid resize — unnecessary complexity for a dashboard overview.

## 0.3.0

### Minor Changes

- [#21](https://github.com/ephor/warpforge/pull/21) [`efed85f`](https://github.com/ephor/warpforge/commit/efed85fc0046f164a51e4b24fd04820896d3c988) Thanks [@lapa2112](https://github.com/lapa2112)! - Adds configurable workflows: a task can now run as a pipeline of agent stages
  instead of a single session. A workflow is a YAML file in your project's
  `.warpforge/workflows/`, and it decides which agent and model runs each stage,
  what each stage is told to do, what the reviewers see, and how many review
  rounds are allowed. Two built-in templates ship with the app — "Implement +
  review loop" and "Plan + implement + review loop" — and either can be copied
  into a project in one click to customize.

  Pick a workflow in the New Task dialog and the daemon drives the run: it plans
  (if the workflow asks for it), implements, then loops review and repair until
  the reviewers approve or the round limit runs out. Reviewers can be several
  different agents at once and return structured verdicts, and a repeat round
  continues in the same reviewer's session so it verifies its own findings
  instead of reviewing from scratch.

  The pipeline reports to the parent task as a timeline of stages, each with the
  agents that ran it — click one to open that agent's own session. It also stops
  for you when it needs to: a stage can ask a question, and running out of review
  rounds asks whether to grant more, finish as is, or stop. Pipelines can be
  paused between stages and resumed with extra guidance, survive a daemon restart
  by parking at their last safe point, and never commit anything — a finished run
  lands in Needs review for you to inspect.

  Reviewers can pin each finding to a line and a short code excerpt, so the
  repair stage goes straight to the right place instead of searching, and the
  summary a stage hands to the next one is its closing message rather than the
  whole turn's tool narration.

### Patch Changes

- [`fb4ebe3`](https://github.com/ephor/warpforge/commit/fb4ebe3a325ffd3fbf4c1179f6c41b9ac93a752e) Thanks [@ephor](https://github.com/ephor)! - The desktop file editor now previews SVG and common binary image files directly in the editor.

- [#21](https://github.com/ephor/warpforge/pull/21) [`efed85f`](https://github.com/ephor/warpforge/commit/efed85fc0046f164a51e4b24fd04820896d3c988) Thanks [@lapa2112](https://github.com/lapa2112)! - The workspace config has a new preferred home at `.warpforge/workspace.yaml`,
  alongside the new `.warpforge/workflows/` directory. Existing config files in
  the project root keep working exactly as before; only newly generated configs
  land in the `.warpforge/` directory.

- [`7f0fb40`](https://github.com/ephor/warpforge/commit/7f0fb408fe035ba67c9914a61ee34429d1d89e4a) Thanks [@ephor](https://github.com/ephor)! - wrap MessageActions dropdown in Portal to fix clipping

- [`3be74e7`](https://github.com/ephor/warpforge/commit/3be74e77def618833d1dc67e3e90dc2bf7710f06) Thanks [@ephor](https://github.com/ephor)! - Allow Mission Control cards to resize beyond the previous fixed height limit, auto-scroll the board while resizing, and preserve a small bottom gap after resizing.

- [`7ffd77e`](https://github.com/ephor/warpforge/commit/7ffd77edaa32304f41a48df55e174db3a604d06e) Thanks [@ephor](https://github.com/ephor)! - Tasks now support inline title editing and one-click AI title regeneration from the task detail view.

## 0.2.0

### Minor Changes

- [#20](https://github.com/ephor/warpforge/pull/20) [`0a54151`](https://github.com/ephor/warpforge/commit/0a541513290253b98f651a2c058823b939013795) Thanks [@ephor](https://github.com/ephor)! - Lets you clear a session out of the way without finishing it. Snooze it for an
  hour, this evening, tomorrow morning, or until next Monday and it comes back
  when the time is up, or settle it to acknowledge it now and keep it quiet until
  something new happens. A running session cannot be settled, and a session
  waiting on a permission request can be neither settled nor snoozed, so nothing
  that needs an answer is silently dismissed.

- [#20](https://github.com/ephor/warpforge/pull/20) [`0a54151`](https://github.com/ephor/warpforge/commit/0a541513290253b98f651a2c058823b939013795) Thanks [@ephor](https://github.com/ephor)! - Keeps an orchestration in the Active lane while any of its agents is still
  running. A review-ready or blocked child no longer pulls the whole group out of
  Active; it stays visible through the group summary and the attention filter.

- [#20](https://github.com/ephor/warpforge/pull/20) [`0a54151`](https://github.com/ephor/warpforge/commit/0a541513290253b98f651a2c058823b939013795) Thanks [@ephor](https://github.com/ephor)! - Keeps the sessions rail beside your work instead of over it. On wide windows it
  is a persistent sidebar that stays open when you enter a task, and it can be
  dragged or keyboard-resized to a width that is remembered between launches. Its
  filter bar is now a Working, Needs you, and All switch with sorting and grouping
  tucked into icon buttons, and session cards show the agent running them.

- [#20](https://github.com/ephor/warpforge/pull/20) [`0a54151`](https://github.com/ephor/warpforge/commit/0a541513290253b98f651a2c058823b939013795) Thanks [@ephor](https://github.com/ephor)! - Gives the rail and the board one shared view of what still needs you. A session
  snoozed for later or settled lands in the same place in both, and the board
  gains Needs attention, Later, and Handled filters with live counts beside each
  group.

### Patch Changes

- [`000aa0d`](https://github.com/ephor/warpforge/commit/000aa0dfc64c3cbdb347bc33ebe25f7dbd2b2305) Thanks [@ephor](https://github.com/ephor)! - Fix port-forward reconnection. Now verifies port is actually bound before reporting active, reclaims stale kubectl processes blocking the port, and uses exponential backoff (2s→30s cap) with a 15-attempt limit before giving up instead of the previous blind retry that would permanently fail after 10 attempts.

- [`1424955`](https://github.com/ephor/warpforge/commit/1424955dd42ab4cf3504f7d02915b5e7ffe79a33) Thanks [@ephor](https://github.com/ephor)! - Refreshes task diffs, project files, and open file contents as soon as an agent
  reports a file edit, so newly changed files can be opened from the conversation
  without manually refreshing the desktop app.

- [#20](https://github.com/ephor/warpforge/pull/20) [`0a54151`](https://github.com/ephor/warpforge/commit/0a541513290253b98f651a2c058823b939013795) Thanks [@ephor](https://github.com/ephor)! - Generates release versions and release notes from changesets, so every release
  carries the notes its contributors wrote instead of hand-maintained version
  metadata.

## [0.1.2]

- Fixes file-type icons and attachment previews in packaged desktop builds by
  allowing only the local, inlined, and object-URL image sources the app uses.
- Adds a release preflight check so an incompatible image content security
  policy cannot reach another packaged release.

## [0.1.1]

- Fixes the macOS application bundle and DMG to display the Warpforge icon
  instead of the generic application placeholder.
- Fixes Claude Code, Codex, OpenCode, and Qwen logos in packaged desktop builds.
- Explains when the published update feed is not available before the first
  signed desktop release instead of exposing a low-level manifest error.

## [0.1.0]

- Introduces the Warpforge desktop app: a local meta-harness for running projects, services, and coding agents from one workspace.
- Adds project management for registering, opening, and removing workspaces without manual setup.
- Moves long-running services and agent sessions into a local daemon so work can continue independently of the desktop window.
- Brings Codex, Claude Code, OpenCode, and custom ACP-compatible agents together with multi-agent orchestration and shared project context.
- Assigns predictable per-project port ranges, allowing multiple projects and agent-built previews to run side by side without port conflicts.
- Implements and delivers application updates with a versioned desktop/daemon protocol and bundled runtime. Windows and Linux builds remain unvalidated previews, and the first end-to-end N→N+1 update test requires a published release.
