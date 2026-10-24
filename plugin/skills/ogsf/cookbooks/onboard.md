# Onboard: write the club config

`ogsf onboard` writes `set_pieces/boardroom/club.config.yaml` — the roster, the defaults, the qa checks and the project's club rules — with the fleet's starter values.

## Generate it

```bash
ogsf onboard
```

It creates the directory if needed and refuses to overwrite an existing config unless you pass `--force`, so retuning an existing roster is a hand edit — see `update_config.md`. `ogsf incorporate` already writes this file; `onboard` is for when only the config is missing, or to start it over.

The path is the default every command looks for; `--config <path>` (or `CLUB_CONFIG`) points any command at another roster.

## The rule

**One player, one prompt, one purpose.** An entry defines who a player *is*: its club, model, thinking level, its tools and write boundary, and exactly one system prompt plus one user prompt. How it gets *used* — the report type, the per-call prompt — lives at the set piece's call site, never here.

## Shape

```yaml
project:
  name: my-project                 # shown to every player in its Club rules
  club_rules:                      # claims about THIS repo, told to every player
    rtl_cleanup: manual
    test_id_attribute: data-testid
    test_id_import: ""
    notes: []

defaults:
  club: pi                         # pi | scripted   (claude_code: not implemented yet)
  model: anthropic/claude-sonnet-5-5   # ALWAYS provider/model-id
  thinking: medium                 # off | minimal | low | medium | high | xhigh | max
  enchantments: []
  tools: [read, bash, edit, write, grep, find, ls]
  restricted_area: [set_pieces/boardroom/, set_pieces/playbooks/]
  data_dir: set_pieces/clubhouse

var:
  match_log: set_pieces/clubhouse/match_log.db
  flush_ms: 1000

qa:
  checks:
    - {name: lint, area: frontend, operation: lint, argv: [npm, run, lint], timeout_seconds: 180, diagnostics: eslint}
    - {name: test, area: frontend, operation: test, argv: [npm, run, test], timeout_seconds: 1800}

players:
  - name: playmaker                # set pieces name players, never models
    thinking: high
    color: "#a78bfa"               # optional: this player's lane on Matchday Live
    purpose: Turn a request into a plan the builder can implement without asking questions.
    team_talks:
      system: set_pieces/clubhouse/team_talks/playmaker/system.md
      user: set_pieces/clubhouse/team_talks/playmaker/user.md
    writes: [specs/]               # the plan is the only thing it may leave in the repo
```

Every player entry merges over `defaults`, so an entry states only what differs. Every key is in `references/config.md`.

## After generating

1. **Point `qa.checks` at this project's commands.** The starter checks are `npm run lint | typecheck | test | build`. A Go project wants `go vet ./...` and `go test ./...`; a Python one `ruff check` and `pytest`. Add `diagnostics: eslint` or `tsc` only where the output really is that tool's.
2. **Fill in `project`.** The name, and the club rules that are true here. A rule is a claim about the repository, not a switch: flip one only in the commit that makes it true.
3. Each player needs its team-talk pair on disk: `set_pieces/clubhouse/team_talks/{name}/system.md` and `user.md`. Validation fails the match at startup if either is missing.
4. Write `purpose` as one sentence and make the system prompt say the same thing — the two should not drift.
5. Validate by running the smallest set piece that names your players (`ogsf ask "ping" --player <name>`); a bad entry fails fast, before anything spawns.
