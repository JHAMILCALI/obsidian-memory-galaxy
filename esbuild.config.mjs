import esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  format: "cjs",
  target: "es2020",
  outfile: "main.js",
  loader: { ".woff2": "dataurl" },
  sourcemap: watch ? "inline" : false,
  minify: !watch,
  logLevel: "info"
});

if (watch) {
  await context.watch();
} else {
  await context.rebuild();
  await context.dispose();
}
