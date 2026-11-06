// ACP agent standing in for a keeper's checker. It advertises a mode
// selector and session/load, logs every session start, mode change, prompt
// and permission answer to argv[2], asks to edit a file on each prompt (the
// daemon must deny it), then replies with the next entry of argv[3]: entries
// are separated by a line `---`, the last one repeats. An entry `WAIT` holds
// the turn until the file `<argv[3]>.go` exists.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const log = process.argv[2];
const replies = process.argv[3];
const note = (entry) => appendFileSync(log, JSON.stringify(entry) + "\n");
const SID = "keeper-session-1";
const mode = {
  id: "mode",
  name: "Mode",
  category: "mode",
  currentValue: "default",
  options: [
    { value: "default", name: "Default" },
    { value: "read-only", name: "Read only" },
  ],
};
let buf = "";
let pending = null;
let nextReqId = 700;
let turns = 0;

const send = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
const update = (u) => send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: SID, update: u } });

function nextReply() {
  const entries = readFileSync(replies, "utf8").split("\n---\n");
  if (entries.length > 1) writeFileSync(replies, entries.slice(1).join("\n---\n"));
  return entries[0];
}

process.stdin.on("data", (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) handle(JSON.parse(line));
  }
});

function answer(reply) {
  if (reply.trim() === "WAIT" && !existsSync(`${replies}.go`)) {
    setTimeout(() => answer(reply), 50);
    return;
  }
  turns += 1;
  update({ sessionUpdate: "usage_update", used: 10, size: 100, cost: { amount: 0.5 * turns, currency: "USD" } });
  const text = reply.trim() === "WAIT" ? readFileSync(`${replies}.go`, "utf8") : reply;
  update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: `${text}\n<!-- ${process.pid} ${turns} -->` } });
  send({ jsonrpc: "2.0", id: pending.id, result: { stopReason: "end_turn" } });
  pending = null;
}

function handle(msg) {
  if (msg.method === "initialize") {
    send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true, promptCapabilities: {} } } });
  } else if (msg.method === "session/new" || msg.method === "session/load") {
    note({ start: msg.method, cwd: msg.params.cwd });
    const result = msg.method === "session/new" ? { sessionId: SID, configOptions: [mode] } : { configOptions: [mode] };
    send({ jsonrpc: "2.0", id: msg.id, result });
  } else if (msg.method === "session/set_config_option") {
    mode.currentValue = msg.params.value;
    note({ set: msg.params.configId, value: msg.params.value });
    send({ jsonrpc: "2.0", id: msg.id, result: { configOptions: [mode] } });
  } else if (msg.method === "session/cancel") {
    if (pending) send({ jsonrpc: "2.0", id: pending.id, result: { stopReason: "cancelled" } });
    pending = null;
  } else if (msg.method === "session/prompt") {
    const text = msg.params.prompt.filter((b) => b.type === "text").map((b) => b.text).join("");
    note({ prompt: text, mode: mode.currentValue });
    pending = { id: msg.id };
    send({
      jsonrpc: "2.0",
      id: nextReqId++,
      method: "session/request_permission",
      params: {
        sessionId: SID,
        toolCall: { toolCallId: `w${nextReqId}`, title: "Edit src/lib.rs" },
        options: [
          { optionId: "yes", name: "Allow", kind: "allow_once" },
          { optionId: "no", name: "Deny", kind: "reject_once" },
        ],
      },
    });
  } else if (msg.method === undefined && msg.result !== undefined && pending && !pending.permitted) {
    note({ permission: msg.result.outcome });
    pending.permitted = true;
    answer(nextReply());
  }
}
