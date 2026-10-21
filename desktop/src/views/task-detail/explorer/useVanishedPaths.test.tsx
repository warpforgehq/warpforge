import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";

import { explorerFromPaths } from "@/lib/explorerFromPaths";

import type { DirListing } from "../../../protocol";
import { useVanishedPaths, vanishedPaths } from "./useVanishedPaths";

const { request } = vi.hoisted(() => ({
  request: vi.fn<(method: string, params: unknown) => Promise<unknown>>(),
}));
vi.mock("@/daemon", () => ({ daemon: { request } }));

const src: DirListing = {
  entries: [{ ignored: false, kind: "file", name: "a.ts", symlink: false }],
  truncated: false,
};

describe("vanishedPaths", () => {
  it("reports a path only when its listed folder no longer holds it", () => {
    const listing = (dir: string) => (dir === "src" ? src : undefined);
    expect(vanishedPaths(["src/a.ts", "src/gone.ts", "lib/b.ts"], listing, new Set())).toEqual([
      "src/gone.ts",
    ]);
  });

  it("keeps paths the caller vouches for, and trusts no truncated folder", () => {
    const listing = (dir: string) => (dir === "src" ? { ...src, truncated: true } : src);
    expect(vanishedPaths(["src/gone.ts"], listing, new Set())).toEqual([]);
    expect(vanishedPaths(["gone.ts"], () => src, new Set(["gone.ts"]))).toEqual([]);
  });
});

describe("useVanishedPaths", () => {
  it("lists only the open tabs' folders, ignored files included", async () => {
    request.mockImplementation(explorerFromPaths(["src/a.ts", ".env"], { ignored: [".env"] }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const tabs = ["src/a.ts", "src/gone.ts", "src/deleted.ts", ".env"];
    const keep = new Set(["src/deleted.ts"]);
    const { result } = renderHook(() => useVanishedPaths({ taskId: "t1" }, tabs, keep), {
      wrapper,
    });

    await waitFor(() => expect(result.current).toEqual(["src/gone.ts"]));
    const listed = request.mock.calls.map(([method, params]) => [method, params]);
    expect(listed).toEqual([
      ["dir.list", { path: "src", task_id: "t1" }],
      ["dir.list", { path: "", task_id: "t1" }],
    ]);
  });
});
