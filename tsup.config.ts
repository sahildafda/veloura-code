import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    cli: "src/cli.tsx",
    index: "src/index.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ["better-sqlite3"],
  async onSuccess() {
    const fs = await import("node:fs");
    try {
      fs.copyFileSync("src/server/webApp.html", "dist/webApp.html");
    } catch {}
  },
  esbuildOptions(options) {
    options.jsx = "automatic";
  },
});
