// Runs the whole suite: extracts the engine from index.html (as extract-engine.sh does), then
// each numbered test in its own process. Exits non-zero if any test does.
//   cd test && npm install && npm test
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const dir = __dirname;
const src = fs.readFileSync(path.join(dir, "..", "index.html"), "utf8").split(/\r?\n/);
const start = src.findIndex((l) => l.startsWith('"use strict";'));
const end = src.findIndex((l) => l.startsWith("const STORAGE_KEY = "));
if (start < 0 || end < 0 || end <= start) {
  console.error("Could not find the engine section in index.html");
  process.exit(1);
}
const exportLine = fs.readFileSync(path.join(dir, "extract-engine.sh"), "utf8").match(/module\.exports = \{[\s\S]*?\};/)[0];
fs.writeFileSync(path.join(dir, "engine.js"), `${src.slice(start, end).join("\n")}\n\n${exportLine}\n`);

const tests = fs.readdirSync(dir).filter((f) => /^\d\d-.*\.js$/.test(f)).sort();
const failed = [];
for (const t of tests) {
  process.stdout.write(`\n=== ${t}\n`);
  const r = spawnSync(process.execPath, [path.join(dir, t)], { cwd: dir, stdio: "inherit" });
  if (r.status !== 0) failed.push(t);
}
console.log(`\n${tests.length - failed.length}/${tests.length} test files passed${failed.length ? `; failed: ${failed.join(", ")}` : ""}`);
process.exitCode = failed.length ? 1 : 0;
