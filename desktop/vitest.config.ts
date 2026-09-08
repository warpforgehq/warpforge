import { fileURLToPath, URL } from "node:url";

import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Same transform the app runs (vite.config.ts), React Compiler included:
// tests that bypass the compiler pass while the compiled UI breaks — that gap
// is how a viewed-accordion regression shipped green.
export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset({ target: "19" })] })],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "jsdom", setupFiles: ["./src/test/setup.ts"], globals: true },
});
