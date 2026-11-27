import { expect, it } from "vitest";

import { isLocalPath, localFieldPaths, mergeConfig, sharedSecretKeys, toEffective } from "./view";

const shared = {
  portforwards: [{ localPort: 5432, name: "db", namespace: "dev", pod: "pg", remotePort: 5432 }],
  services: { api: { command: "bun dev", env: { A: "1" }, port: 3000 } },
};

it("merges the overlay the way the daemon does", () => {
  const local = {
    portforwards: [{ localPort: 6543, name: "db" }],
    services: { api: { env: { B: "2" }, port: null }, web: { command: "vite" } },
  };
  const merged = toEffective(mergeConfig(shared, local), "demo", localFieldPaths(local));

  expect(merged.services.api).toMatchObject({
    command: "bun dev",
    env: { A: "1", B: "2" },
    port: null,
  });
  expect(merged.services.web!.command).toBe("vite");
  expect(merged.portforwards[0]!.localPort).toBe(6543);
  expect(merged.name).toBe("demo");
  expect(isLocalPath(merged.localFields, ["services", "api", "env", "B"])).toBe(true);
  expect(isLocalPath(merged.localFields, ["services", "api", "env", "A"])).toBe(false);
  expect(isLocalPath(merged.localFields, ["portforwards", "db", "localPort"])).toBe(true);
});

it("removes a forward marked remove in the overlay", () => {
  const merged = mergeConfig(shared, { portforwards: [{ name: "db", remove: true }] });
  expect(merged.portforwards).toEqual([]);
});

it("finds secret-looking env keys bound for the shared file", () => {
  expect(
    sharedSecretKeys([
      {
        base: undefined,
        path: ["services", "api", "env", "API_TOKEN"],
        scope: "shared",
        value: "x",
      },
      {
        base: undefined,
        path: ["services", "api", "env", "DB_PASSWORD"],
        scope: "local",
        value: "x",
      },
      {
        base: undefined,
        path: ["services", "web"],
        scope: "shared",
        value: { env: { SECRET: "y", PORT: "1" } },
      },
      { base: undefined, path: ["services", "api", "env", "HOST"], scope: "shared", value: "x" },
    ]),
  ).toEqual(["API_TOKEN", "SECRET"]);
});
