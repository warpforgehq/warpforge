// ACP agent for the force-send tests. Its holding turn streams a fragment and
// then waits: only `session/cancel` ends it, answering the outstanding
// `session/prompt` with stopReason "cancelled", the way a real adapter does.
// Every other turn answers and ends on its own. Prompt arrivals (with every
// marker they carry, in order), cancels and turn ends go into a log file for
// the test to assert on.
//
// `ignoreCancels` models the agent this feature's grace window exists for: one
// that keeps working through the first cancels it is sent.
//
// argv: <log path> [holding turn, default 1] [cancels to ignore, default 0]

import fs from "node:fs";

const logPath = process.argv[2];
const holdTurn = Number(process.argv[3] ?? 1);
let ignoreCancels = Number(process.argv[4] ?? 0);
const sid = "mock-interrupt-1";
const markers = ["PROMPT_A", "PROMPT_B", "PROMPT_C", "PROMPT_D"];

let buf = "";
let turn = 0;
let outstanding = null;

const log = (line) => fs.appendFileSync(logPath, line + "\n");
const send = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
const update = (u) =>
  send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: sid, update: u } });

function handle(msg) {
  if (msg.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: 1,
        agentCapabilities: { promptCapabilities: { image: false, embeddedContext: false } },
      },
    });
    return;
  }
  if (msg.method === "session/new") {
    send({ jsonrpc: "2.0", id: msg.id, result: { sessionId: sid } });
    return;
  }
  if (msg.method === "session/cancel") {
    log("cancel");
    if (ignoreCancels > 0) {
      ignoreCancels -= 1;
      return;
    }
    if (outstanding !== null) {
      send({ jsonrpc: "2.0", id: outstanding, result: { stopReason: "cancelled" } });
      log(`turn${turn}:cancelled`);
      outstanding = null;
    }
    return;
  }
  if (msg.method !== "session/prompt") return;

  const text = (msg.params?.prompt ?? []).map((block) => block.text ?? "").join("");
  // Every marker the prompt carries, in the order the text carries them: a
  // force-send merges the whole queue into one prompt, and the order is the
  // part worth asserting on.
  const found = markers
    .filter((m) => text.includes(m))
    .sort((a, b) => text.indexOf(a) - text.indexOf(b));
  const marker = found.join("+") || "unknown";
  if (outstanding !== null) log("overlap");
  turn += 1;
  log(`prompt:${marker}`);
  log(`turn${turn}:start`);

  if (turn === holdTurn) {
    update({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "HALF_FINISHED_THOUGHT" },
    });
    outstanding = msg.id;
    return;
  }
  update({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: `DONE_${marker}` },
  });
  send({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } });
  log(`turn${turn}:end`);
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
