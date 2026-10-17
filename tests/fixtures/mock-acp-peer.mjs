// ACP agent for the peer-messaging tests. Logs every prompt's full text as
// one JSON line, so a test can assert on the framing the agent was given.
// Turn 1 holds until the gate file exists, when one is named; every other
// turn answers and ends on its own.
//
// argv: <log path> [gate path]

import fs from "node:fs";

const [logPath, gatePath] = process.argv.slice(2);
const sid = "mock-peer-1";
let buf = "";
let turn = 0;

const send = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
const log = (obj) => fs.appendFileSync(logPath, JSON.stringify(obj) + "\n");

function finish(id, n) {
  send({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: sid,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `ANSWER_${n}` } },
    },
  });
  send({ jsonrpc: "2.0", id, result: { stopReason: "end_turn" } });
  log({ turn: n, end: true });
}

function handle(msg) {
  if (msg.method === "initialize") {
    send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 1, agentCapabilities: {} } });
  } else if (msg.method === "session/new") {
    send({ jsonrpc: "2.0", id: msg.id, result: { sessionId: sid } });
  } else if (msg.method === "session/prompt") {
    turn += 1;
    const n = turn;
    const text = (msg.params?.prompt ?? []).map((block) => block.text ?? "").join("");
    log({ turn: n, text });
    if (n === 1 && gatePath) {
      const wait = setInterval(() => {
        if (fs.existsSync(gatePath)) {
          clearInterval(wait);
          finish(msg.id, n);
        }
      }, 20);
    } else {
      finish(msg.id, n);
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
