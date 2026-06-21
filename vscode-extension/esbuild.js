const esbuild = require("esbuild");

esbuild
  .build({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    outfile: "dist/extension.js",
    platform: "node",
    format: "cjs",
    target: "node18",
    external: ["vscode"],
    minify: process.argv.includes("--production"),
    sourcemap: !process.argv.includes("--production"),
  })
  .catch(() => process.exit(1));
