"""Write the Go templates for the spec tools from the legacy Python sources.

The legacy specs are built with f-strings. Python's own parser already holds
each f-string's literal text unescaped (`{{` is `{`, `\\n` is `\n`), so the
templates are taken from the syntax tree instead of being copied by hand:
every literal part is kept exactly, every `{expression}` becomes a named
placeholder `⟦name⟧`, and then the vocabulary substitutions in
substitutions.json are applied to the literal text.

Run from the repository root after changing a legacy source or the
substitution list, then run the Go tests:

    python3 modernized/backroom_staff/spectools/testdata/extract_templates.py

The golden tests prove the result: Go's output must equal the Python output
with the same substitutions applied.
"""

import ast
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
LEGACY = HERE.parents[3] / "legacy" / "adws"
OUT = HERE.parent / "templates"

SUBSTITUTIONS = json.loads((HERE / "substitutions.json").read_text())

AREA_CONTRACT = {"files": "files", "writes": "writes", "name": "name", "specs": "specs", "jest_check": "jest_check"}
AREA_RENDER = {
    "scope": "scope", "label": "label", "name": "name", "contract(name, prefixes, rows)": "contract",
    "len(rows)": "n_rows", "len(dirty)": "n_dirty", "total": "total", "rule_list": "rule_list",
    "table": "table", "tests[0]": "tests0", "tests[1]": "tests1", "broken_text": "broken_text",
    "jest_text": "jest_text", "node_text": "node_text", "site_list": "site_list",
    "name.split('-')[0]": "name_head", "name.replace('-', ', ')": "name_spaced",
}
TYPE_SPEC = {
    "len(files)": "n_files", "a.label": "label", "', the pilot' if a.pilot else ''": "pilot",
    "q": "q", "writes": "writes", "base": "base", "emit_files": "emit_files", "check3": "check3",
    "check4": "check4", "spec": "spec", "slug": "slug", "len(rows)": "n_rows",
    "helper_note": "helper_note", "helper_block": "helper_block", "table_text": "table_text",
    "sources_text": "sources_text", "frag": "frag",
}


def template(node: ast.JoinedStr, names: dict) -> str:
    out = []
    for part in node.values:
        if isinstance(part, ast.Constant):
            out.append(part.value)
        else:
            source = ast.unparse(part.value)
            out.append("⟦" + names[source] + "⟧")
    return "".join(out)


def substitute(text: str) -> str:
    for old, new in SUBSTITUTIONS:
        text = text.replace(old, new)
    return text


def largest_fstring(fn) -> ast.JoinedStr:
    strings = [n for n in ast.walk(fn) if isinstance(n, ast.JoinedStr)]
    return max(strings, key=lambda n: len(n.values))


def main() -> None:
    OUT.mkdir(exist_ok=True)
    area = ast.parse((LEGACY / "adw_area_spec.py").read_text())
    funcs = {f.name: f for f in area.body if isinstance(f, ast.FunctionDef)}
    (OUT / "area_contract.tmpl").write_text(
        substitute(template(largest_fstring(funcs["contract"]), AREA_CONTRACT)))
    (OUT / "area_render.tmpl").write_text(
        substitute(template(largest_fstring(funcs["render"]), AREA_RENDER)))

    types = ast.parse((LEGACY / "adw_type_spec.py").read_text())
    out_assign = next(n for n in types.body if isinstance(n, ast.Assign)
                      and getattr(n.targets[0], "id", "") == "out")
    (OUT / "type_spec.tmpl").write_text(substitute(template(out_assign.value, TYPE_SPEC)))
    print("wrote", ", ".join(p.name for p in sorted(OUT.glob("*.tmpl"))))


if __name__ == "__main__":
    main()
