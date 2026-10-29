// ACP fixture that writes touched.txt into its working directory on each prompt.
import { writeFileSync } from "node:fs";

let buf = "";
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

process.stdin.on("data", (chunk) => {
  buf += chunk;
  let newline;
  while ((newline = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, newline).trim();
    buf = buf.slice(newline + 1);
    if (line) handle(JSON.parse(line));
  }
});

function handle(message) {
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1, agentCapabilities: {} } });
  } else if (message.method === "session/new") {
    send({ jsonrpc: "2.0", id: message.id, result: { sessionId: "touch-session" } });
  } else if (message.method === "session/prompt") {
    writeFileSync("touched.txt", process.cwd());
    send({ jsonrpc: "2.0", id: message.id, result: { stopReason: "end_turn" } });
  }
}
