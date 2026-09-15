// ACP agent for the prompt-serialization tests. Speaks newline-delimited
// JSON-RPC 2.0 and models the failure the daemon must prevent: a *second*
// `session/prompt` arriving while one is still outstanding makes the agent end
// the running turn early (as a real adapter does when it has nothing left to
// say). Every prompt arrival is timestamped into a log file so the test can
// assert the daemon delivered them one at a time, in order.
//
// argv: <log path> <first-turn hold ms>

import fs from "node:fs";

const logPath = process.argv[2];
const holdMs = Number(process.argv[3] ?? 300);
const sid = "mock-serial-1";
const markers = ["PROMPT_A", "PROMPT_B", "PROMPT_C", "PROMPT_D"];

let buf = "";
let turn = 0;
let pending = [];
const log = (line) => fs.appendFileSync(logPath, line + "\n");
const send = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");

function finish(entry) {
  if (!pending.includes(entry)) return;
  pending = pending.filter((p) => p !== entry);
  log(`turn${entry.turn}:end`);
  send({
    jsonrpc: "2.0",
    id: entry.id,
    result: { stopReason: "end_turn" },
  });
}

function handle(msg) {
  if (msg.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: 1,
        agentCapabilities: {
          promptCapabilities: { image: false, embeddedContext: false },
        },
      },
    });
    return;
  }
  if (msg.method === "session/new") {
    send({ jsonrpc: "2.0", id: msg.id, result: { sessionId: sid } });
    return;
  }
  if (msg.method !== "session/prompt") return;

  const text = (msg.params?.prompt ?? [])
    .map((block) => block.text ?? "")
    .join("");
  const marker = markers.find((m) => text.includes(m)) ?? "unknown";
  log(`prompt:${marker}`);

  if (pending.length > 0) {
    // A concurrent prompt. A real agent ends the in-flight turn here; record
    // it, then finish the oldest turn so the daemon's early-TurnEnded flap is
    // observable rather than merely logged.
    log(`overlap:${pending.length + 1}`);
    finish(pending[0]);
  }

  turn += 1;
  const entry = { id: msg.id, turn };
  pending.push(entry);
  const delay = turn === 1 ? holdMs : 20;
  log(`turn${turn}:start`);
  setTimeout(() => finish(entry), delay);
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
