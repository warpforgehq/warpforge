// ACP agent for the Smith tests. Logs every request it receives — method and
// params, `_meta` included — as one JSON line, supports session/load, and
// ends every turn at once.
//
// argv: <log path>

import fs from "node:fs";

const logPath = process.argv[2];
const sid = "mock-smith-1";
let buf = "";
let turn = 0;

const send = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
const log = (obj) => fs.appendFileSync(logPath, JSON.stringify(obj) + "\n");

function handle(msg) {
  if (msg.method) log({ method: msg.method, params: msg.params });
  if (msg.method === "initialize") {
    send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true } } });
  } else if (msg.method === "session/new") {
    send({ jsonrpc: "2.0", id: msg.id, result: { sessionId: sid } });
  } else if (msg.method === "session/load") {
    send({ jsonrpc: "2.0", id: msg.id, result: {} });
  } else if (msg.method === "session/prompt") {
    // A distinct answer per turn and process, so the daemon's resume replay
    // guard never mistakes a live turn for replayed history.
    turn += 1;
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId: sid, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `OK ${process.pid} ${turn}` } } },
    });
    send({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } });
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
