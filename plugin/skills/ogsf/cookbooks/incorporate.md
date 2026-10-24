# Incorporate

`ogsf incorporate` — put the fleet into the current repository: the config, the team talks, the enchantments, the spec-tool helpers, a `.env.sample` and the `.gitignore` lines.

## Run it

```bash
ogsf incorporate
```

Run from the **target repository's root** — the working directory is where everything lands. No `ogsf` yet? Install the binary first (`go install <module>/cmd/ogsf@latest`, or a release build) and check `ogsf --version`.

## What gets stamped

The templates are built into the binary, so a fresh Mac needs nothing but `ogsf`:

| Stamped | Tracked? |
|---|---|
| `set_pieces/boardroom/club.config.yaml` | yes — the roster, the qa checks, the restricted area |
| `set_pieces/clubhouse/team_talks/{playmaker,builder,ranger,safety_officer,bard}/{system,user}.md` | yes — **the founder-owned home for prompts** |
| `set_pieces/clubhouse/enchantments/subagents.ts`, `themeMap.ts` | yes — **the founder-owned home for Pi extensions** |
| `set_pieces/clubhouse/spec_tools/same_emit.cjs`, `ts4111_sources.cjs` | yes — helpers `ogsf spec-types` and its contracts call |
| `set_pieces/playbooks/README.md` | yes — where playbooks go |
| `.env.sample` | yes — every variable the fleet or Pi reads, with blanks |
| `.gitignore` lines: `set_pieces/clubhouse/matches/`, `set_pieces/clubhouse/match_log.db*`, `.env` | — |
| `set_pieces/clubhouse/matches/`, `set_pieces/clubhouse/match_log.db` | no — created at run time, gitignored |

`team_talks` is what a player is told; `enchantments` is what its club can do. Both are the founder's the moment they are stamped. `subagents.ts` backs the `sub_bring_on` / `sub_instruct` / `sub_bench_list` / `sub_take_off` tools that the playmaker and the ranger use in the starter roster.

## Idempotency

Re-running is safe. `incorporate` skips **every** file that already exists — the config, the prompts, everything — and reports how many it skipped, so a second run doubles as a drift check. `--force` overwrites ALL of them, including `club.config.yaml` and `team_talks/`, so commit or back up the founder's edits first.

## After incorporating

1. **Env** — `cp .env.sample .env`, then set `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY` for the models in the roster. The fleet never reads these; Pi does. `.env` is never committed (incorporate added it to `.gitignore`).
2. **Pi is installed and on PATH** — `pi --version`. Set `PI_PATH` in `.env` if it is not.
3. **The models resolve** — `pi --list-models` is the catalog `ogsf` resolves against. Write every model as `provider/model-id` (see `references/config.md`).
4. **Gitignore** — confirm the three lines landed. The match runtime and `.env` must never be committed.
5. **Git repository** — set pieces that ship (`talk-attack`, `run-normal`, `run-heroic`, `run-mythic`) commit with git and refuse outside a repository; `bard` diffs against a base ref. Run `git init` and make a first commit before using them.
6. **The qa checks** — the starter config runs `npm run lint | typecheck | test | build`. Point `qa.checks` at this project's own commands (`update_config.md`) before any set piece that tests.
7. **See every set piece once, for free** — `ogsf demo` builds a throwaway repository and runs every set piece in it with the scripted club: no model, no token, nothing changed here. `ogsf demo --serve` opens the result in Matchday Live.
8. **Smoke test with a real club** — `ogsf demo --real` runs two cheap read-only matches in this repository (`ask` with the ranger, then `scout-opposition`), or run the smallest one directly:

```bash
ogsf ask "reply with a one-line summary of this repo" --player ranger
ogsf matches
```

A touchdown means the whole path works: config validated, match minted, Pi ran, report parsed, events in the match log. If the smoke test fails, fix it before running anything larger — every multi-player set piece rides on this exact path.

9. **Optional: watch from anywhere** — set up Matchday Live on Vercel and the relay (`observe.md`).
