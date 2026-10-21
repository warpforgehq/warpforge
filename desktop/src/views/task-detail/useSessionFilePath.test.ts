import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useSessionFilePath } from "./useSessionFilePath";

describe("useSessionFilePath", () => {
  const { result } = renderHook(() =>
    useSessionFilePath({
      diffFiles: undefined,
      openTabs: ["notes/open.md"],
      projectRoot: "/repo",
      trackedFiles: [{ changed: false, path: "src/main.rs" }],
    }),
  );
  const resolve = result.current;

  it("resolves tracked files, open tabs and anything absolute under the checkout", () => {
    expect(resolve("`./src/main.rs:12`")).toBe("src/main.rs");
    expect(resolve("notes/open.md")).toBe("notes/open.md");
    expect(resolve("/repo/.env")).toBe(".env");
  });

  it("leaves a relative path to a file it does not list unresolved", () => {
    expect(resolve(".env")).toBeNull();
    expect(resolve("src/missing.rs")).toBeNull();
  });
});
