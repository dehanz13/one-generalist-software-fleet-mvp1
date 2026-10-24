"""Record the legacy Python spec tools' output for fixed inputs.

The Go tests hold the port to these files: Go's output must equal each one
once the vocabulary substitutions in substitutions.json are applied. Run from
the repository root whenever an input case changes:

    python3 modernized/backroom_staff/spectools/testdata/make_goldens.py

Needs only python3 (stdlib) and git.
"""

import collections
import importlib.util
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
LEGACY = HERE.parents[3] / "legacy" / "adws"
GOLDEN = HERE / "golden"


def load_area():
    spec = importlib.util.spec_from_file_location("adw_area_spec", LEGACY / "adw_area_spec.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def counter(pairs):
    c = collections.Counter()
    for key, value in pairs:
        c[key] = value
    return c


def area_goldens(area) -> None:
    for case in json.loads((HERE / "area_cases.json").read_text()):
        rows = []
        for r in case["rows"]:
            row = dict(r)
            row["rules"] = counter(r["rules"])
            row["left"] = counter(r["left"])
            row["sites"] = [tuple(s) for s in r["sites"]]
            rows.append(row)
        rendered = area.render(case["name"], case["label"], case["prefixes"], rows, tuple(case["tests"]))
        (GOLDEN / f"area_render_{case['case']}.md").write_text(rendered)
        contract = area.contract(case["name"], case["prefixes"], rows)
        (GOLDEN / f"area_contract_{case['case']}.md").write_text(contract)


AREA_RUNS = [
    # (case, extra flags): the whole tool, measuring included, over area_repo
    ("e2e", []),
    ("e2e-only-with-errors", ["--only-with-errors"]),
]


def area_repo(root: Path) -> dict:
    """Stamp area_repo into a fresh git repository and put the fake npx on PATH."""
    shutil.copytree(HERE / "area_repo", root, dirs_exist_ok=True)
    git(root, "init", "-q")
    git(root, "config", "user.email", "t@example.invalid")
    git(root, "config", "user.name", "t")
    git(root, "config", "commit.gpgsign", "false")
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "base")
    bin_dir = root / ".bin"
    bin_dir.mkdir()
    shutil.copy(HERE / "fake_npx.sh", bin_dir / "npx")
    (bin_dir / "npx").chmod(0o755)
    env = dict(os.environ)
    env["PATH"] = f"{bin_dir}{os.pathsep}{env['PATH']}"
    return env


def area_runs() -> None:
    for case, flags in AREA_RUNS:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repo"
            root.mkdir()
            env = area_repo(root)
            Path(root, "specs/beta-18-slices").mkdir(parents=True)
            argv = ["python3", str(LEGACY / "adw_area_spec.py"), "--name", "home-a11y",
                    "--label", "group 7", *flags, "components/home", "components/a11y"]
            done = subprocess.run(argv, cwd=root, env=env, capture_output=True, text=True, check=True)
            out = Path(root, "specs/beta-18-slices/testing-library-clean-home-a11y.md").read_text()
            (GOLDEN / f"area_spec_{case}.md").write_text(out)
            (GOLDEN / f"area_spec_{case}.stdout").write_text(done.stdout)


def git(cwd, *args):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)


TYPE_CASES = [
    # (case, helper file committed, --pilot)
    ("no-helper", False, False),
    ("helper-pilot", True, True),
]


def type_goldens() -> None:
    for case, helper, pilot in TYPE_CASES:
        with tempfile.TemporaryDirectory() as root:
            git(root, "init", "-q")
            git(root, "config", "user.email", "t@example.invalid")
            git(root, "config", "user.name", "t")
            git(root, "config", "commit.gpgsign", "false")
            Path(root, "README.md").write_text("x\n")
            if helper:
                Path(root, "lib").mkdir()
                Path(root, "lib/unchecked-fields.ts").write_text("export type UncheckedFields = never;\n")
            git(root, "add", "-A")
            git(root, "commit", "-q", "-m", "base")
            Path(root, "specs/beta-18-slices").mkdir(parents=True)
            shutil.copy(HERE / "types_src.json", Path(root, "src.json"))
            argv = ["python3", str(LEGACY / "adw_type_spec.py"), "--src", "src.json",
                    "--name", "rooms-and-routes", "--label", "group 2"]
            if pilot:
                argv.append("--pilot")
            argv += ["lib", "app"]
            done = subprocess.run(argv, cwd=root, capture_output=True, text=True, check=True)
            out = Path(root, "specs/beta-18-slices/typed-records-rooms-and-routes.md").read_text()
            (GOLDEN / f"type_spec_{case}.md").write_text(out)
            (GOLDEN / f"type_spec_{case}.stdout").write_text(done.stdout)


def shape_golden() -> None:
    """Run legacy's scan over shapes.diff, with git replaced by the fixture."""
    import contextlib
    import io
    import types

    spec = importlib.util.spec_from_file_location("adw_shape_search", LEGACY / "adw_shape_search.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    diff = (HERE / "shapes.diff").read_text()
    module.subprocess = types.SimpleNamespace(
        run=lambda *args, **kwargs: types.SimpleNamespace(stdout=diff))
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        module.scan("HEAD~1..HEAD", "fixture")
    (GOLDEN / "shapes.txt").write_text(out.getvalue())


def shape_probes() -> None:
    """Legacy's three lookahead/backreference patterns, judged on probe lines.

    Go's regexp has neither feature, so the port re-expresses them; the Go
    test holds the re-expressed ones to these verdicts.
    """
    import re

    probes = json.loads((HERE / "shape_probes.json").read_text())
    patterns = {
        "aria": r"""querySelector(?:All)?(?:<[^>]*>)?\(\s*([`'"])(?:(?!\1).)*\[aria-""",
        "alternatives": r"""querySelector(?:All)?(?:<[^>]*>)?\(\s*([`'"])(?:(?!\1).)*,(?:(?!\1).)*\1""",
        "data_not_hook": r"""querySelector(?:All)?(?:<[^>]*>)?\(\s*[`'"]\[data-(?!hp=)([\w-]+)=""",
    }
    out = {name: [bool(re.search(p, line)) for line in probes] for name, p in patterns.items()}
    (GOLDEN / "shape_probes.json").write_text(json.dumps(out, indent=1))


FIRE_DRILL_BREAKS = [
    ("label breaks", "src/thing.ts", "deep", "shallow", "src/thing.test.ts"),
    ("answer breaks", "src/thing.ts", "42", "41", "src/thing.test.ts"),
    ("harmless", "src/thing.ts", "export const answer", "export  const answer", "src/thing.test.ts"),
    ("missing", "src/thing.ts", "nope", "x", "src/thing.test.ts"),
]


def fire_drill_golden() -> None:
    """Legacy's break review over the repository firedrill_test.go builds."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "repo"
        (root / "src").mkdir(parents=True)
        git(root, "init", "-q")
        git(root, "config", "user.email", "t@example.invalid")
        git(root, "config", "user.name", "t")
        git(root, "config", "commit.gpgsign", "false")
        (root / "src/thing.ts").write_text("export const answer = 42;\nexport const label = 'deep';\n")
        (root / "src/thing.test.ts").write_text("test answer needs 42\ntest label needs deep\n")
        git(root, "add", "-A")
        git(root, "commit", "-q", "-m", "base")
        base = subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, capture_output=True,
                              text=True, check=True).stdout.strip()
        (root / "src/thing.test.ts").write_text("test answer needs 42\n")
        git(root, "commit", "-qam", "rewrite the test")
        # Outside a folder named adws, legacy's REPO is the working directory.
        tools = Path(tmp) / "tools"
        tools.mkdir()
        shutil.copy(LEGACY / "adw_break_review.py", tools / "adw_break_review.py")
        (tools / "batch.py").write_text("BREAKS = " + repr(FIRE_DRILL_BREAKS) + "\n")
        bin_dir = Path(tmp) / "bin"
        bin_dir.mkdir()
        shutil.copy(HERE / "fake_runner.sh", bin_dir / "npx")
        (bin_dir / "npx").chmod(0o755)
        env = dict(os.environ, PATH=f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
                   FAKE_LOG=str(Path(tmp) / "calls.log"))
        done = subprocess.run(["python3", str(tools / "adw_break_review.py"), "--base", base,
                               str(tools / "batch.py")], cwd=root, env=env, capture_output=True, text=True)
        assert done.returncode == 1, done
        (GOLDEN / "fire_drill.txt").write_text(done.stdout)


def main() -> None:
    GOLDEN.mkdir(exist_ok=True)
    shape_probes()
    fire_drill_golden()
    area_goldens(load_area())
    area_runs()
    type_goldens()
    shape_golden()
    print("wrote", len(list(GOLDEN.iterdir())), "golden files in", GOLDEN)


if __name__ == "__main__":
    os.environ.setdefault("GIT_CONFIG_NOSYSTEM", "1")
    main()
