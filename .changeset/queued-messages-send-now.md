---
"warpforge": patch
---

Messages you send while an agent is still working now wait somewhere you can see them. They stack above the composer with their full text, instead of dropping into the chat as if the agent had already read them — a message joins the conversation at the moment the agent is actually handed it, so what you are reading is what the agent was told. Each waiting message then gets a turn of its own: the task shows running while the agent works on it and waiting only when the agent is really done, so a follow-up no longer leaves a busy session looking like it is your move. If you would rather not wait, "Send all now" stops what the agent is doing and hands it every waiting message at once, in the order you wrote them, so it acts on the whole correction instead of the first line of it; the half-finished answer it was writing is dropped rather than recorded as its reply. A scheduled run's prompt caught in the same queue keeps its own turn, so its result stays its own.
