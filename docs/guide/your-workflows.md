# Your own workflows

The thirteen set pieces cover the common shapes of work. Your own shapes
come in three sizes: a **playbook** (your own chain of players), a
**quest** (a spec the machine can hold a match to), and a **new player**.
You can also drive all of it from Claude Code with the plugin.

## A playbook: your own chain of players

A playbook is a list of players, each handed the previous one's report.
Say you often want the ranger to find something and the builder to fix it:

```sh
ogsf write-playbook --name find_and_fix --players ranger,builder
```

That writes `set_pieces/playbooks/find_and_fix.yaml`:

```yaml
name: find_and_fix
description: …
steps:
  - player: ranger
    description: …
  - player: builder
    description: …
```

Replace each `description` with one sentence on what that step is *for*,
such as "Find every place the date is formatted by hand". It is the only
statement of intent the record, the console and Matchday Live ever show,
so a description that only repeats the step's name is refused when the
match starts. Then:

```sh
ogsf play find_and_fix "Dates are formatted three different ways; use formatDate everywhere."
```

Playbooks run every player in order and do not commit. They live in the
restricted area, so no player can rewrite the chain it is running in.

## A quest with a contract

For large work, such as a lint clean-up across a codebase or a refactor in
steps, cut it into **quests**: one spec per slice, each run with
`run-mythic`, each judged on whether it moved the codebase forward.

### 1 · Write the spec

Quest specs live under `specs/<area>-quests/`. The prose is for the
players; the ` ```ogsf ` block is for the machine:

````md
# Contact form: lint clean

Fix every ESLint error in components/contact/. Do not change behaviour;
the existing tests must keep passing.

```ogsf
difficulty: run-mythic
precondition: |
  test "$(npx eslint components/contact --format json | jq '[.[].errorCount]|add')" -gt 0
writes:
  - components/contact/*
checks:
  - name: touched files are lint-clean
    run: git diff --name-only HEAD | xargs npx eslint --no-warn-ignored
```
````

- `precondition` exits 0 while work **remains**. Once the quest has landed
  it exits non-zero, and the kickoff checklist refuses to run it twice.
- `writes` is every path the match may change (`*` crosses `/`). The scope
  check fails a round that touches anything else.
- `checks` are commands that must pass on the built tree before the slow
  qa gate runs.

The spec tools can write the measured parts for you: `ogsf spec-area` and
`ogsf spec-types` count what is really there, so the numbers in a spec are
real (`ogsf --help` lists them under "Spec tools").

### 2 · Branch, commit, run

The kickoff checklist expects the branch to be named after the spec file:
`specs/contact-quests/01-lint.md` runs from `feature/01-lint`.

```sh
git switch -c feature/01-lint
git add specs/contact-quests/01-lint.md && git commit -m "docs(specs): contact lint quest"
ogsf run-mythic specs/contact-quests/01-lint.md
```

What happens, in order: the kickoff checklist (clean tree, the branch, the
spec committed and not already merged, the contract's difficulty and
precondition); the playmaker's plan and its **ruling** (it can stop the
match here if the work is already done or cannot be done); the **line of
scrimmage** (every lint and type problem before the build); the build; then
up to three rounds of **scope check → progressive gate → iterate**; and one
commit if the gate is green. The diagram is on
[the set pieces](../set-pieces.md#run-mythic) page.

### 3 · When it turns over

Fix what is left by hand if you like, commit it, and re-verify without
paying for players again:

```sh
ogsf run-mythic specs/contact-quests/01-lint.md --match-id <the failed match id>
```

With the id of a failed match, `run-mythic` only runs the strict gate on
the tree as it is now.

## A new player

Add an entry under `players:` in `club.config.yaml` and give it team talks:

```yaml
  - name: migrator
    model: anthropic/claude-sonnet-5-5
    thinking: high
    purpose: Write database migrations; change nothing else.
    writes:
      - db/migrations/
    team_talks:
      system: set_pieces/clubhouse/team_talks/migrator/system.md
      user: set_pieces/clubhouse/team_talks/migrator/user.md
    tools: [read, grep, find, ls, bash, write]
```

Copy a starter's team talks (`team_talks/builder/`) as a starting point.
The `user.md` ends with the match report the player must hand back; a
player that is not one of the five starters answers with a `GenericReport`.
Use it in a playbook (`--players ranger,migrator`) or with
`ogsf ask … --player migrator`.

Every set piece validates the players it needs before anything spawns: a
missing team talk, a misspelt player or a model the club cannot resolve
fails in the first second, not after a build.

## From Claude Code

The plugin in `plugin/` teaches Claude Code to run and watch the fleet: ask
it to "run the timer request on run-heroic", "write a playbook for
find-and-fix", "plan Monday's tickets" or "pull this week's report", and it
uses the `ogsf` binary to do it. It never does a player's work itself.

```sh
claude --plugin-dir /path/to/ogsf-fleet/modernized/plugin
```

`plugin/README.md` shows how to install it from a marketplace instead.
