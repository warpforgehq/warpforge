declare module "node:fs" {
  export function readFileSync(path: string | URL, encoding: "utf8"): string;
}

declare module "node:child_process" {
  export function spawnSync(
    command: string,
    args: string[],
    options: { cwd?: string; encoding?: "utf8"; maxBuffer?: number },
  ): { status: number | null; stdout: string; stderr: string };
}
