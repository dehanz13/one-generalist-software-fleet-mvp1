# Update the config

Add or retune players, the restricted area and the qa checks in `set_pieces/boardroom/club.config.yaml`.

## Retune model or thinking

Edit the player's entry in place:

```yaml
  - name: builder
    model: openai/gpt-5.3-codex       # ALWAYS provider/model-id
    thinking: high                   # was medium
```

Write the model as `provider/model-id`, never a bare id. The same model is often carried by several providers, and an ambiguous pattern fails validation — grounding every player that inherits it. See `references/config.md`.

Thinking levels are Pi's reasoning effort: `off | minimal | low | medium | high | xhigh | max`. It only bites when the model is registered as a reasoning model in Pi's catalog.

**A model change means a fresh club session.** `club_sessions.json` records the model each session was created with. When a joined match (`--match-id`) finds the config's model no longer matches, that player starts a **new** session rather than resuming — never a bad resume. Thinking changes keep the session; model changes do not. Expect the player to lose its accumulated context on the first match after the change.

## Recolour a player's lane

```yaml
  - name: builder
    color: "#22d3ee"
```

Purely cosmetic and safe to change mid-project: the colour rides the `raider_start` event and the `club_sessions` row, so Matchday Live picks it up on the next match without touching past ones. Omit it to let the page choose.

## Retune tools

Pi's seven builtins: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`. The last three are **off in bare Pi**, so a player that doesn't name them shells out through `bash` to search and list.

Set the roster-wide floor in `defaults`, then narrow per player:

```yaml
defaults:
  tools: [read, bash, edit, write, grep, find, ls]

players:
  - name: safety_officer
    tools: [read, grep, find, ls, bash, write]   # its own list wins over defaults
```

**Resolution:** the player's own list wins → else it inherits `defaults.tools` → else nothing is set, meaning all tools. An empty list is not "all tools"; it is a tool-less player, and it will stall.

Narrow by role, not by reflex:

- Any player that must produce a torch-pass artifact needs **`write`** — without it, it falls back to a `bash` heredoc to create the file its official review checks for.
- Withhold `edit` only where the restriction *is* the guarantee. The safety officer's contract is "change nothing", so withholding `edit` makes that structural instead of merely prompted. (The real boundary is `writes`, below.)
- Recon players get the full read surface (`read`, `grep`, `find`, `ls`) — cheaper and more legible in the record than the equivalent `bash` calls.

**Enchantment tools count against the allowlist.** Pi's `--tools` filters built-in, extension and custom tools alike. Once a player has a `tools` list — its own or inherited — a tool registered by one of its `enchantments` is dropped unless it is named there. Nothing errors: the extension loads, the match passes, the tool is never offered. That is why the starter playmaker and ranger list `sub_bring_on`, `sub_instruct`, `sub_bench_list` and `sub_take_off` beside `subagents.ts`.

## Add an enchantment

```yaml
    enchantments:
      - set_pieces/clubhouse/enchantments/json_guard.ts   # a Pi extension FILE PATH
```

Entries are Pi extension **file paths**, passed as `pi -e <path>`, for that player only. Reach for an output-tightening extension when a player keeps wrapping its report in prose and burning correction retries.

**Adding a tool-registering extension is a two-part edit:** the path in `enchantments`, *and* the tool's name in that player's `tools`. Skip the second half and it fails silently.

## Set the write boundary: `writes` and `restricted_area`

`tools` cannot express a safety boundary: `bash` runs anything, including `git checkout`, and `write` reaches any path. So what a player may **change in the repository** is enforced in code, after every player call:

```yaml
defaults:
  restricted_area: [set_pieces/boardroom/, set_pieces/playbooks/]   # no player, unless it names them

players:
  - name: builder        # no `writes` key → unrestricted, minus the restricted area
  - name: ranger
    writes: []           # read-only in the repo; its findings still land in the torch pass
  - name: playmaker
    writes: [specs/]
  - name: bard
    writes: [app_docs/, docs/, "**/*.md", "*.md"]
```

Patterns: a trailing `/` is a directory prefix, `*` and `?` stay inside one path segment, `**` crosses segments, anything else is exact. Naming a restricted path in a player's own `writes` is what unlocks it for that player. The match runtime under `data_dir` is always writable — `writes: []` means read-only with respect to the repository, never unable to write its own report.

A breach is not a review failure: the write already happened, so re-prompting fixes nothing. Every change the player **introduced** outside its boundary is rolled back (a new file deleted, a tracked file checked out), a path that was already dirty before the player started is left alone (that was the founder's work), and the objective is lost with every path named. Keep the fleet's own machinery restricted: a player must not be able to edit what decides whether its work passed.

## Change the qa checks

```yaml
qa:
  checks:
    - name: vet
      area: backend
      operation: lint
      argv: [go, vet, ./...]
      timeout_seconds: 300
    - name: test
      area: backend
      operation: test
      argv: [go, test, ./...]
      timeout_seconds: 1800
```

- `operation` decides how the gate uses a check: `test` checks are what the test objectives run; every check runs in `qa`; a `build` check waits until every `typecheck` check passes (a build runs the same type check and cannot pass before it).
- `diagnostics: eslint` or `tsc` names the parser the progressive gate (`run-mythic`) uses to tell a NEW problem from an old one, so a quest may leave old problems standing but never add one. A check without it is judged by its exit code. Name a parser only when the output really is that tool's: a failed run the parser cannot read stops the match rather than counting as zero problems.
- Each check runs in the repository root with the founder's environment, is killed with all its children at `timeout_seconds` (exit 124), and keeps its full output in the torch pass as `qa/<seq>_<name>/command.log`.

A known command belongs here, never in a player: running the suite needs no judgement, only repairing it does.

## Add a new player

Three steps, all required — skipping any one fails validation at startup, before anything spawns:

1. **Team talks.** Create `set_pieces/clubhouse/team_talks/{name}/system.md` and `user.md` (`update_team_talks.md`).
2. **Config entry.** Name, purpose, team-talk paths, plus whatever differs from `defaults` — and its `writes`.
3. **A report type.** A playbook gives an unknown player `GenericReport`. For a sharper report — fields the next player needs, a review that checks them — add a report type in Go (`add_set_piece.md`), and make the `## Match report` section of its `user.md` show exactly that JSON.

## Rules that do not bend

- Set pieces and playbooks name **players**, never models. Swapping a model is a config edit and touches no code.
- One player, one prompt, one purpose. If an entry needs two purposes, it is two players.
- Report types never appear in the config — they live at the call site, paired with the user prompt.

Full spec: `references/config.md`.
