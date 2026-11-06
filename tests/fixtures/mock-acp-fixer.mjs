// ACP agent standing in for a task's own session in the keeper fixer tests.
// It supports session/load, logs every prompt and cancel to argv[2] as JSON
// lines, and answers each prompt at once — unless the file argv[3] exists and
// the prompt contains its text: that turn holds until `<argv[3]>.go` exists
// or the turn is cancelled.
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const log = process.argv[2];
const hold = process.argv[3];
const note = (entry) => appendFileSync(log, JSON.stringify(entry) + "\n");
const SID = "fixer-session-1";
let buf = "";
let pending = null;

const send = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
const update = (u) => send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: SID, update: u } });

process.stdin.on("data", (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) handle(JSON.parse(line));
  }
});

function held(text) {
  if (!existsSync(hold)) return false;
  const marker = readFileSync(hold, "utf8").trim();
  return marker !== "" && text.includes(marker);
}

function finish(id) {
  if (pending === null || pending.id !== id) return;
  if (pending.held && !existsSync(`${hold}.go`)) {
    setTimeout(() => finish(id), 30);
    return;
  }
  update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done." } });
  send({ jsonrpc: "2.0", id, result: { stopReason: "end_turn" } });
  pending = null;
}

function handle(msg) {
  if (msg.method === "initialize") {
    send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true, promptCapabilities: {} } } });
  } else if (msg.method === "session/new" || msg.method === "session/load") {
    send({ jsonrpc: "2.0", id: msg.id, result: msg.method === "session/new" ? { sessionId: SID } : {} });
  } else if (msg.method === "session/cancel") {
    note({ cancel: true });
    if (pending) send({ jsonrpc: "2.0", id: pending.id, result: { stopReason: "cancelled" } });
    pending = null;
  } else if (msg.method === "session/prompt") {
    const text = msg.params.prompt.filter((b) => b.type === "text").map((b) => b.text).join("");
    note({ prompt: text });
    pending = { id: msg.id, held: held(text) };
    setTimeout(() => finish(msg.id), 10);
  }
}
