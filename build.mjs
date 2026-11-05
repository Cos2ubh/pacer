// Bundles each entry point into dist/ and copies the static files next to them.
import * as esbuild from "esbuild";
import { cp, mkdir } from "node:fs/promises";

const watch = process.argv.includes("--watch");

const options = {
  entryPoints: {
    content: "src/content.ts",
    background: "src/background.ts",
    popup: "src/popup.ts",
  },
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "chrome110",
  logLevel: "info",
};

await mkdir("dist", { recursive: true });
await cp("static", "dist", { recursive: true });

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
