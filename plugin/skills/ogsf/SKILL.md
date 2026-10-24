---
name: ogsf
description: One Generalist Software Fleet — run and observe repeatable set pieces (players plus plain code) in any repository with the `ogsf` binary. Use when the founder says ogsf, incorporate the fleet, run a set piece (ask, scout-opposition, team-talk, talk-attack, run-normal, run-heroic, run-mythic, attack, attack-var, attack-review, bard, qa, play), write a playbook, retune players in club.config.yaml, watch matches (ogsf var, Matchday Live, the match log), plan a sprint (Upcoming Matches, ogsf scheduler, ogsf request), pull daily or multi-day reports, or drive the fleet from the Claude app (Remote Control, the Matchday Live connector).
argument-hint: "[incorporate | run <set piece> | write playbook | update config | watch <match_id> | ...]"
---

# One Generalist Software Fleet (OGSF)

A reusable combination of **players plus code**. Plain Go code in the `ogsf` binary owns the order of work, the retries and the acceptance. Players (models, run through a club such as Pi) work inside bounded objectives. Typed JSON match reports carry context from one player to the next. Every event streams into the match log (SQLite) and, when a relay is set up, to Matchday Live on Vercel. The player proposes; the code disposes.

**Credit.** The design is IndyDevDan's: [Super Simple Software Factory](https://github.com/disler/super-simple-software-factory) (MIT) — deterministic code owns the sequence and agents are bounded steps inside it. Danniel's additions are the kickoff checklist, the quest contract, the ruling as a stop, the progressive qa gate, the commit normaliser, match abandoned (the provider stop) and the spec tools. Say this plainly whenever you describe the fleet.

## Startup

Three steps. Then stop.

1. Read [cookbooks/overview.md](cookbooks/overview.md) — the system map.
2. Run `ogsf --help` (the "Set pieces" group) and `ls set_pieces/playbooks/*.yaml 2>/dev/null`. Set pieces are compiled into the binary; playbooks are the founder's own chains, on disk.
3. Print the set pieces and playbooks as a table — command, the chain, one line on when to reach for it — and **wait for the founder's request.**

```
| Set piece | Chain | Use when |
|---|---|---|
| scout-opposition | founder → ranger | read-only recon; nothing changes |
| run-heroic | spec → build → test → review → document, 3 commits | the work is real and its shape is not obvious |
```

`ogsf <set piece> --help` prints a set piece's objectives on its `Objectives:` line when you need the full chain.

**Nothing else.** No match-log queries, no reading the config, no repo inventory, no last-matches summary, no diagnosing an old failure, no "current state" dashboard. None of it was asked for, and it is not free:

- **Volunteered state is guessed state.** An orchestrator that improvised a status board once queried tables and columns that did not exist. The spec that would have said so (`references/observability.md`) is one lazy read away. Probing to look prepared is how you end up confidently wrong in your first message.
- **It spends the context the real task needs**, before you know what the task is.
- **It is stale on arrival.** State printed before the request describes a system that the very next match changes.

Everything else — the match log, the roster, the hand-over contract — is lazy-loaded through the routing table below, when a request actually calls for it. Reading it early defeats the mechanism.

Two exceptions, both narrow: if the founder's first message already contains a request, skip the waiting and route it; and if the fleet is plainly not set up here (no `set_pieces/boardroom/club.config.yaml`, or no `ogsf` on PATH), say that in one line instead of the table.

## Orchestrator rules

You run the system, observe the system, and help the founder interact with it. **You do no set-piece work yourself:**

- Never implement, plan, review or test in a player's place — launch the set piece and watch it.
- Never edit files inside `set_pieces/clubhouse/matches/` — that is the match's record (the torch pass, the reports, the raw streams).
- Observe through `ogsf matches | passages | live-feed | on-pitch` and `ogsf var` **when observing is the task**. This is a capability, not a startup step: use it to follow a match you launched or one the founder asked about, never to volunteer a status report nobody requested.
- Report objective status plainly: name, owner, status, error if any.

## Request routing (lazy-load the cookbook, then follow it)

| Request | Cookbook |
|---|---|
| put the fleet into this repo, first run | [cookbooks/incorporate.md](cookbooks/incorporate.md) |
| run / launch a set piece | [cookbooks/how_to_prompt_for_the_founder.md](cookbooks/how_to_prompt_for_the_founder.md) **first**, then [cookbooks/run_set_piece.md](cookbooks/run_set_piece.md) |
| turn a request into a set-piece prompt | [cookbooks/how_to_prompt_for_the_founder.md](cookbooks/how_to_prompt_for_the_founder.md) |
| watch, diagnose or stop a match; Matchday Live; the relay | [cookbooks/observe.md](cookbooks/observe.md) |
| create a new chain of players | [cookbooks/create_playbook.md](cookbooks/create_playbook.md) |
| change a playbook | [cookbooks/update_playbook.md](cookbooks/update_playbook.md) |
| write the club config | [cookbooks/onboard.md](cookbooks/onboard.md) |
| add or retune a player (model, thinking, tools, writes), the restricted area, qa checks | [cookbooks/update_config.md](cookbooks/update_config.md) |
| change what a player is told | [cookbooks/update_team_talks.md](cookbooks/update_team_talks.md) |
| add or change a set piece, a report type or an official review in Go (contributors) | [cookbooks/add_set_piece.md](cookbooks/add_set_piece.md) |
| plan a sprint, write tickets, run or debug `ogsf scheduler`, queue a request | [cookbooks/upcoming_matches.md](cookbooks/upcoming_matches.md) |
| how did the fleet do: daily or multi-day reports, player performance, cost, PDF or Markdown downloads | [cookbooks/performance.md](cookbooks/performance.md) |
| run or check the fleet from a phone or the Claude app: Remote Control, the Matchday Live connector | [cookbooks/remote_control.md](cookbooks/remote_control.md) |

Deep specs, when needed: [references/config.md](references/config.md) · [references/handoff.md](references/handoff.md) · [references/observability.md](references/observability.md)

To explain the fleet to the founder, point at the docs in the fleet's own repository (`modernized/docs/`, also the **Docs** and **Guide** sections of Matchday Live) instead of writing your own explanation: `overview.md`, `components.md`, `set-pieces.md`, `safety.md`, and `guide/` step by step.

## Hard rules (enforced across everything the fleet runs)

1. **Validate before running.** Every set piece declares the players it needs and validates them before its first objective: a missing or misnamed player, a missing team talk, a model the club cannot resolve, all fail before anything spawns. A playbook validates every player it names.
2. **Typed match reports only.** Every player call names a concrete report type (`TalkReport`, `AttackReport`, `AnalystReport`, `VarReport`, `BardReport`, `GenericReport`); the reply is parsed against it, and a bad reply is corrected in the **same** club session, context intact — never a cold restart.
   **The output contract is a synced triad**: (a) the Go type in `backroom_staff/reports`, (b) the JSON example in the player's `user.md` `## Match report` section, (c) the `ReportType` at every call site. These are ONE contract — change any one and update all three in the same change.
3. **Official reviews verify claims, not guesses.** A review returns one check per item it looked at (`ball_in_play`, `ball_not_flat`, `replay_matches_report`, `decision_stands`); violations go back to the same session as a correction, bounded by the objective's `Retries`.
4. **Four-param rule.** A function with more than four parameters takes one struct instead — `match.Params` and `match.Call` are the pattern.
5. **One player, one prompt, one purpose.** Identity lives in `system.md`; the task shape (user prompt + report type) lives at the call site.
6. **Set pieces stay thin.** A set piece sequences objectives and decides acceptance; everything low-level lives in `backroom_staff/`.
7. **Every objective earns a description** — one sentence on what it does and why, never a restatement of its name. It is the only intent the record, the console and Matchday Live ever show; `ship_spec: "Ship the spec"` is refused before the objective opens, and so is a blank one.
8. **A known command is a qa check, not a player.** If you can write the invocation down (`npm test`, `go vet`), it belongs in `qa.checks` in the config and runs in a referee objective. Players are for the parts that need reading and deciding; a failure still comes back to the builder as a `QaReport`.
9. **`tools:` is a capability list; `writes:` is the boundary.** `bash` runs anything (including `git checkout`) and `write` reaches any path, so a tool list can never make "this player changes nothing" true. `writes:` per player and `restricted_area` in the defaults are enforced after every player call: unauthorized changes are rolled back and the objective is lost. The match runtime under `data_dir` is always writable — a read-only player is read-only with respect to the REPO, never mute.
10. **Every set piece ends in `Finish`.** Objectives passing is not the same as the match being accepted: a test objective that ran a red suite did its job. `Finish(accepted, reason)` decides the exit code, the match status and the banner together, so the three cannot disagree.

## v1 scope

- **Clubs:** `pi` (the real one; direct Anthropic and OpenAI models, default `anthropic/claude-sonnet-5-5`, thinking `medium`) and `scripted` (plays a script instead of a model — the tests and `ogsf demo` use it, so no token is spent). `claude_code` is accepted by the config and refused at validation until its driver is written.
- **Watching:** `ogsf var` serves Matchday Live on `http://127.0.0.1:4600` from this Mac's match log. With `CLUB_RELAY_URL` and `CLUB_RELAY_TOKEN` set, every match is also relayed to the founder's Matchday Live deployment on Vercel.
- **Planning:** Upcoming Matches (Markdown tickets in `set_pieces/upcoming/*.md`; Linear is reserved for later) and `ogsf scheduler`, which starts due `auto` tickets and, only with `scheduler.accept_remote: true`, requests from the page, the connector or `ogsf request`. One match at a time.
- **Remote:** Matchday Live on Vercel hosts a remote MCP server (`/api/mcp`, the Claude connector) for reports, status and queued requests; Claude Code's own Remote Control drives a whole session on the Mac.
- **Not yet:** a git worktree per match, lanes fully as data, a Linear source. The founder decided to port first and extend later.
