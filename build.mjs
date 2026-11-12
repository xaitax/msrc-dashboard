// Bundles the extension into dist/ (load dist/ unpacked in brave://extensions).
import * as esbuild from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const watch = process.argv.includes("--watch");
const common = { bundle: true, target: "chrome120", sourcemap: "linked", logLevel: "info", legalComments: "none" };

const builds = [
  { ...common, entryPoints: { background: "src/background/index.ts" }, format: "esm", outdir: "dist" },
  // Content scripts cannot be ES modules — classic IIFE.
  { ...common, entryPoints: { content: "src/content/index.ts" }, format: "iife", outdir: "dist" },
  {
    ...common,
    entryPoints: { dashboard: "src/dashboard/main.tsx" },
    format: "esm",
    outdir: "dist",
    jsx: "automatic",
    jsxImportSource: "preact",
  },
];

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
cpSync("static", "dist", { recursive: true });
// Fonts (Instrument Sans, SIL OFL) live in static/fonts/ and are copied with the rest.

if (watch) {
  for (const b of builds) await (await esbuild.context(b)).watch();
  console.log("watching… (static/ is copied once; restart after editing it)");
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
}
