// For every TS4111 diagnostic: the type the property is read from, and where that type is declared.
//   node set_pieces/clubhouse/spec_tools/ts4111_sources.cjs /tmp/src.json   then: ogsf spec-types --src /tmp/src.json ...
const ts = require(process.cwd() + "/node_modules/typescript");
const path = require("path"), fs = require("fs");
const cfgPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, "tsconfig.json");
const cfg = ts.parseJsonConfigFileContent(ts.readConfigFile(cfgPath, ts.sys.readFile).config, ts.sys, process.cwd());
const program = ts.createProgram(cfg.fileNames, { ...cfg.options, noEmit: true, incremental: false });
const checker = program.getTypeChecker();
const rel = (f) => path.relative(process.cwd(), f);
function nodeAt(sf, pos) {
  let found;
  (function walk(n) { if (pos >= n.getStart(sf) && pos < n.getEnd()) { found = n; ts.forEachChild(n, walk); } })(sf);
  return found;
}
// Where the loose type is WRITTEN: follows a name back through an initializer,
// a call's return type, a property's declaration or the array a callback's
// parameter comes from. This is the place a real type would go; it can be a
// helper in another file (group 1's pond fakes), which the name alone hides.
const locOf = (d) => { const sf = d.getSourceFile(); return rel(sf.fileName) + ":" + (sf.getLineAndCharacterOfPosition(d.getStart(sf)).line + 1); };
function sourceOf(e, depth = 0) {
  if (!e || depth > 8) return null;
  while (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAwaitExpression(e)) e = e.expression;
  if (ts.isAsExpression(e) || ts.isSatisfiesExpression(e)) return locOf(e);
  if (ts.isIdentifier(e)) {
    const s = checker.getSymbolAtLocation(e); const d = s && (s.valueDeclaration || (s.declarations && s.declarations[0]));
    if (!d) return null;
    if (ts.isVariableDeclaration(d)) return d.type ? locOf(d) : (sourceOf(d.initializer, depth + 1) || locOf(d));
    if (ts.isParameter(d)) {
      if (d.type) return locOf(d);
      const call = d.parent && d.parent.parent;
      if (call && ts.isCallExpression(call)) return sourceOf(ts.isPropertyAccessExpression(call.expression) ? call.expression.expression : call.expression, depth + 1) || locOf(d);
      return locOf(d);
    }
    if (ts.isBindingElement(d)) {
      let p = d.parent; while (p && !ts.isVariableDeclaration(p) && !ts.isParameter(p)) p = p.parent;
      if (p && ts.isVariableDeclaration(p)) return p.type ? locOf(p) : (sourceOf(p.initializer, depth + 1) || locOf(p));
      return locOf(d);
    }
    return locOf(d);
  }
  if (ts.isPropertyAccessExpression(e)) {
    const s = checker.getSymbolAtLocation(e.name); const d = s && (s.valueDeclaration || (s.declarations && s.declarations[0]));
    return d ? locOf(d) : sourceOf(e.expression, depth + 1);
  }
  if (ts.isElementAccessExpression(e)) return sourceOf(e.expression, depth + 1);
  if (ts.isCallExpression(e)) { const sig = checker.getResolvedSignature(e); return sig && sig.declaration ? locOf(sig.declaration) : sourceOf(e.expression, depth + 1); }
  return null;
}
const out = [];
for (const d of ts.getPreEmitDiagnostics(program)) {
  if (d.code !== 4111 || !d.file) continue;
  const file = rel(d.file.fileName);
  if (file.startsWith("set_pieces/")) continue;
  let n = nodeAt(d.file, d.start);
  while (n && !ts.isPropertyAccessExpression(n)) n = n.parent;
  if (!n) { out.push({ file, type: "?", decl: "?" }); continue; }
  const t = checker.getTypeAtLocation(n.expression);
  const apparent = checker.getApparentType(checker.getNonNullableType(t));
  const typeStr = checker.typeToString(t, undefined, ts.TypeFormatFlags.NoTruncation).slice(0, 160);
  // where the index signature that answered this read is declared
  let decl = "?";
  const parts = apparent.isUnion() ? apparent.types : [apparent];
  for (const p of parts) {
    const info = checker.getIndexInfoOfType(p, ts.IndexKind.String);
    if (info && info.declaration) { const sf = info.declaration.getSourceFile(); const lc = sf.getLineAndCharacterOfPosition(info.declaration.getStart(sf)); decl = rel(sf.fileName) + ":" + (lc.line + 1); break; }
    const sym = p.aliasSymbol || p.symbol;
    if (info && sym && sym.declarations && sym.declarations[0]) { const dd = sym.declarations[0]; const sf = dd.getSourceFile(); decl = rel(sf.fileName) + ":" + (sf.getLineAndCharacterOfPosition(dd.getStart(sf)).line + 1) + " (" + sym.name + ")"; break; }
    if (info) decl = "inline or mapped: " + checker.typeToString(p).slice(0, 80);
  }
  // the declaration the receiver's leftmost name comes from: the place a real type would be written
  let left = n.expression;
  while (ts.isPropertyAccessExpression(left) || ts.isElementAccessExpression(left) || ts.isCallExpression(left) || ts.isNonNullExpression(left) || ts.isParenthesizedExpression(left) || ts.isAwaitExpression(left) || ts.isAsExpression(left)) left = left.expression;
  let root = "?", rootText = "", rootFile = "", rootStart = -1, rootEnd = -1;
  const rs = ts.isIdentifier(left) ? checker.getSymbolAtLocation(left) : undefined;
  const rd = rs && (rs.valueDeclaration || (rs.declarations && rs.declarations[0]));
  if (rd) { const sf = rd.getSourceFile(); root = rel(sf.fileName) + ":" + (sf.getLineAndCharacterOfPosition(rd.getStart(sf)).line + 1); rootText = rd.getText(sf).replace(/\s+/g, " ").slice(0, 110); rootFile = rel(sf.fileName); rootStart = rd.getStart(sf); rootEnd = rd.getEnd(); }
  // a write (`r.x = …`, `delete r.x`, `r.x++`): the value is being built, not read
  const par = n.parent;
  const write = (ts.isBinaryExpression(par) && par.left === n && par.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && par.operatorToken.kind <= ts.SyntaxKind.LastAssignment) || ts.isDeleteExpression(par) || ts.isPostfixUnaryExpression(par) || (ts.isPrefixUnaryExpression(par) && (par.operator === ts.SyntaxKind.PlusPlusToken || par.operator === ts.SyntaxKind.MinusMinusToken));
  const alias = t.aliasSymbol ? t.aliasSymbol.name : (t.symbol ? t.symbol.name : "");
  out.push({ file, prop: n.name.text, recv: n.expression.getText(d.file).slice(0, 60), type: typeStr, alias, decl, source: sourceOf(n.expression) || root, root, rootText, rootFile, rootStart, rootEnd, write, direct: ts.isIdentifier(n.expression), line: d.file.getLineAndCharacterOfPosition(d.start).line + 1 });
}
fs.writeFileSync(process.argv[2], JSON.stringify(out));
console.log(out.length, "TS4111 diagnostics");
