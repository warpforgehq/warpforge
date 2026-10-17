// ACP agent that tries to change things: on its first prompt it writes a file
// through fs/write_text_file and asks for a permission, logs the client's
// answer to each as one JSON line, then ends the turn.
//
// argv: <log path> <file to write>

import fs from "node:fs";

const [logPath, target] = process.argv.slice(2);
const sid = "mock-writer-1";
let buf = "";
let prompt = null;
let answers = 0;

const send = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
const log = (obj) => fs.appendFileSync(logPath, JSON.stringify(obj) + "\n");

function handle(msg) {
  if (msg.method === "initialize") {
    send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 1, agentCapabilities: {} } });
  } else if (msg.method === "session/new") {
    send({ jsonrpc: "2.0", id: msg.id, result: { sessionId: sid } });
  } else if (msg.method === "session/prompt") {
    prompt = msg.id;
    send({ jsonrpc: "2.0", id: 900, method: "fs/write_text_file", params: { sessionId: sid, path: target, content: "x" } });
    send({
      jsonrpc: "2.0",
      id: 901,
      method: "session/request_permission",
      params: {
        sessionId: sid,
        toolCall: { toolCallId: "tc1", title: "Run `rm -rf build`" },
        options: [
          { optionId: "allow", name: "Allow", kind: "allow_once" },
          { optionId: "deny", name: "Deny", kind: "reject_once" },
        ],
      },
    });
  } else if (msg.id === 900 || msg.id === 901) {
    log({ id: msg.id, result: msg.result ?? null, error: msg.error ?? null });
    answers += 1;
    if (answers === 2 && prompt !== null) {
      send({ jsonrpc: "2.0", id: prompt, result: { stopReason: "end_turn" } });
      prompt = null;
    }
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
