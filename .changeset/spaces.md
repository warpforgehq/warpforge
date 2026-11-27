---
"warpforge": minor
---

**Spaces: one product, many repositories.** When your app lives in a monorepo, a couple of infra repos and a schemas repo, group them into a space and agents see all of them at once. Start a task in any project of the space and its agent can read and change the others too, and knows where each one is. The task shows **+N repos** in the title bar so you always know what it can reach.

Create a space in Settings → Spaces & repos, or right-click a project and choose **Add to space**. A repository can also list its siblings under `linked:` in its `workspace.yaml`, so the whole team gets the same space. Open a space to see its projects and the tasks of all of them in one place, and pin it to the rail. New Task in a space offers only its projects.
