// ACP agent for the channel conversation tests. Logs every request as one
// JSON line, like mock-acp-smith.mjs. A turn answers "<name> reply <n>" when
// its prompt carries a new user post, NOTHING_TO_ADD otherwise or when the
// prompt says "stay quiet". While the gate file exists a turn does not end.
//
// argv: <log path> <name> [gate path]

import fs from "node:fs";

const [logPath, name, gate] = process.argv.slice(2);
const sid = `mock-channel-${name}`;
let buf = "";
let turn = 0;

const send = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
const log = (obj) => fs.appendFileSync(logPath, JSON.stringify(obj) + "\n");

function answer(text) {
  if (text.includes("stay quiet")) return "NOTHING_TO_ADD";
  if (/<peer_message kind="user-post"[^>]*new="true">/.test(text)) return `${name} reply ${turn} ${process.pid}`;
  if (!text.includes("<channel_turn")) return `${name} ok ${turn} ${process.pid}`;
  return "NOTHING_TO_ADD";
}

function finish(msg, text) {
  if (gate && fs.existsSync(gate)) {
    setTimeout(() => finish(msg, text), 20);
    return;
  }
  send({
    jsonrpc: "2.0",
    method: "session/update",
    params: { sessionId: sid, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: answer(text) } } },
  });
  send({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } });
}

function handle(msg) {
  if (msg.method) log({ method: msg.method, params: msg.params });
  if (msg.method === "initialize") {
    send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true } } });
  } else if (msg.method === "session/new") {
    send({ jsonrpc: "2.0", id: msg.id, result: { sessionId: sid } });
  } else if (msg.method === "session/load") {
    send({ jsonrpc: "2.0", id: msg.id, result: {} });
  } else if (msg.method === "session/prompt") {
    turn += 1;
    const text = (msg.params.prompt ?? []).map((block) => block.text ?? "").join("");
    finish(msg, text);
  }
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
