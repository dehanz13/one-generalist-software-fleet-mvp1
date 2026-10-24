// Is each file's JavaScript the same as at a base commit, once types and comments are taken out?
// A type-only change (an annotation, a cast, a type alias, `import type`) leaves it identical.
//   node set_pieces/clubhouse/spec_tools/same_emit.cjs <base-commit> <file> [<file> ...]      exit 1 if any file differs
const ts = require(process.cwd() + "/node_modules/typescript");
const { execFileSync } = require("child_process"), fs = require("fs");
const [base, ...files] = process.argv.slice(2);
const emit = (text, name) => ts.transpileModule(text, { fileName: name, compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve, removeComments: true, isolatedModules: true, verbatimModuleSyntax: false } }).outputText.replace(/\n\s*\n/g, "\n");
let differ = 0;
for (const f of files) {
  let before;
  try { before = execFileSync("git", ["show", `${base}:${f}`], { encoding: "utf8", maxBuffer: 1 << 26 }); } catch { console.log(`${f}: new file, nothing to compare with`); differ++; continue; }
  const a = emit(before, f).split("\n"), b = emit(fs.readFileSync(f, "utf8"), f).split("\n");
  if (a.join("\n") === b.join("\n")) continue;
  differ++;
  const i = a.findIndex((l, n) => l !== b[n]);
  console.log(`${f}: the emitted JavaScript differs, first at emitted line ${i + 1}\n  was: ${(a[i] || "").trim().slice(0, 140)}\n  now: ${(b[i] || "").trim().slice(0, 140)}`);
}
console.log(`examined ${files.length} files, ${differ} differ`);
process.exit(differ ? 1 : 0);
