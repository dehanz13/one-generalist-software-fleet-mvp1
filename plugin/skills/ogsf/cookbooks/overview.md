# OGSF overview

The system map the orchestrator reads on startup: what the fleet is, how an incorporated repository is laid out, and which cookbook to load next.

## What the fleet is

One Generalist Software Fleet runs repeatable **players plus code** set pieces. Plain Go code (a set piece, compiled into `ogsf`) owns sequencing, retries and acceptance; players are bounded objectives inside that chain. The player proposes; the code disposes.

Your job as orchestrator: **run the system, observe the system, help the founder interact with it.** You do not do the work a set piece exists to do.

## Layout of an incorporated repository

```
set_pieces/
├── boardroom/
│   └── club.config.yaml          the roster — one player, one prompt, one purpose
├── playbooks/                    the founder's own chains, as data: ogsf play <name>
├── upcoming/*.md                 Upcoming Matches: dated tickets the Scheduler can start
└── clubhouse/                    data_dir
    ├── team_talks/{player}/{system.md,user.md}   tracked — edit prompts HERE
    │                 playmaker · builder · ranger · safety_officer · bard
    ├── enchantments/             Pi extensions (subagents.ts registers the sub_* tools)
    ├── spec_tools/               helpers the spec tools call (JavaScript)
    ├── matches/{match_id}/       gitignored runtime: the match's own record
    │   ├── match_feed.jsonl      every event, appended as it happens
    │   ├── club_sessions.json    player → club session id + model
    │   ├── torch_pass/           the ONE place players write files for the players that follow
    │   └── {player}/{team_talks/, raw_output.jsonl, match_report.json}
    └── match_log.db              gitignored SQLite match log; `ogsf var` reads it
```

The set pieces themselves are not in the repository: they live in the binary (`set_pieces/` in the fleet's own source). A chain the founder adds is a **playbook** (YAML) under `set_pieces/playbooks/`.

## Who does what: objective kinds

Every match is a sequence of **objectives**. Three kinds, three lanes on Matchday Live:

- **head_coach** — the founder's lane: the `ask` objective that records who asked, and for what.
- **player** — a model through a club: prompt in → typed match report out → official reviews verified.
- **referee** — plain code that stands alone: `qa`, `scope_check`, `changes`, `ship` (git commit). Never buried inside a player objective.

**A touchdown must be earned — every objective is a turnover until it ends cleanly.** A player objective additionally needs its report to parse, its official reviews to pass, and its writes to stay inside its `writes`. An error ends the objective as a turnover, records an `error` event, and stops the match. `Retries: N` on a player objective buys extra review-correction rounds through the same club session before that happens.

## Match reports

Players have exactly two output channels: files written into `torch_pass/`, and a **final valid-JSON reply** parsed against the report type the call declared. Code keeps it as `match_report.json` and hands it to the next player's `user.md` as `{{previous_report}}`. Bad JSON is never a restart — the harness re-prompts the *same session, context intact*, until it parses (bounded). See `references/handoff.md`.

**The output contract is a synced triad**: the Go type in `backroom_staff/reports` ↔ the `## Match report` JSON in the player's `user.md` ↔ the `ReportType` at the call site. Editing any one means editing all three in the same change — drift between them taxes every call with correction retries.

## Running a set piece

```bash
ogsf team-talk "add a /health endpoint"
ogsf talk-attack requests/health.md --match-id a1b2c3d4
```

The prompt is inline text or a file path. `--match-id` is optional on every set piece: given one, the match joins that id (same directories, same torch pass, players resume their existing context windows); omitted, a fresh id is minted and printed.

## When you have finished reading this

You are done with startup. Run `ogsf --help`, list the playbooks on disk, print them as a table, and **wait for the founder's request.**

Do not survey anything else — not the match log, not the config, not past matches, not the repo tree. You do not yet know what the request is, so anything you gather now is a guess about what will matter, spent from the context the real work needs. Every cookbook and reference is lazy-loaded, one per request, and that is the whole design.

## Beyond one match

Planned work (Upcoming Matches, `ogsf scheduler`), reports across days, and the Claude app (Remote Control and the Matchday Live connector) each have a cookbook; the routing table in `SKILL.md` says which. The founder-facing explanation of everything is in the fleet's `modernized/docs/` (the Docs and Guide on Matchday Live).

## Where to go next

Load one cookbook per request — this overview is the only one you read up front. The routing table is in `SKILL.md`. References, loaded when you need the spec: `references/config.md` (every config key), `references/handoff.md` (match reports, the torch pass, corrections), `references/observability.md` (events and the match log).
