# Run a set piece

Launch a set piece and report on it. **You run and observe — you never step into the match or do the work yourself.**

## Step 0 — translate the request

**Read [how_to_prompt_for_the_founder.md](how_to_prompt_for_the_founder.md) before you launch anything.** The prompt you pass is read by every player in the chain, so it gets written deliberately: same intent, sharper words, verified paths, and a stated "done means". That cookbook also picks the set piece. This one starts once you have the prompt.

## The orchestrator's posture

The set piece is the worker. Your job is to launch it, watch the match, and tell the founder what happened. Do not read the files a player is working on and "help", do not fix the code a player was supposed to fix, do not edit a match report. If a match fails, report the failing objective and its violations — the fix is a config, team talk, playbook or set-piece change, made deliberately, and then another match.

## The set pieces

| Command | Chain (objectives) | Accepted when |
|---|---|---|
| `ask "<prompt>" [--player builder]` | ask → answer (any player, `GenericReport`) | every objective passes |
| `scout-opposition` | ask → ranger (`AnalystReport`; `ball_in_play`) | every objective passes |
| `team-talk` | ask → playmaker spec (`TalkReport`; `ball_in_play`, `ball_not_flat`) | every objective passes |
| `attack` | ask → builder build (`AttackReport`; `replay_matches_report`, 1 retry) | every objective passes |
| `talk-attack` | ask → spec → build → ship | every objective passes |
| `run-normal` | ask → spec → build → (test_i → iterate_i) ×3 → ship if green | the suite is green |
| `attack-var` | ask → build → (test_i → iterate_i) ×3 | the suite is green |
| `attack-review` | ask → build → (review_i → revise_i) ×3 | the safety officer approved |
| `bard "<prompt>" [--base main]` | ask → changes (an empty diff fails) → document | every objective passes |
| `qa` | ask → qa (every check, strict; red fails) | every objective passes |
| `run-heroic` | ask → spec → [ruling stop] → ship_spec → build → (test_i → iterate_i) ×3 → (review_i → revise_i) ×2 → retest if revised → ship_build → changes → document → ship_docs | the suite is green AND the safety officer approved |
| `run-mythic <spec>` | [qa_rerun on a failed id] ask → spec → [ruling stop] → benchmark → build → (scope_check_i → qa_i if the scope is clean → iterate_i) ×3 → ship if green | the contract is clean AND the progressive gate is green |
| `play <playbook>` | ask → each player in the playbook, report to report | every objective passes |

`ogsf <command> --help` prints the exact chain on its `Objectives:` line. Bounds are constants in the code (extra time `MaxExtraTime = 3`), never prompt prose.

## Launch

```bash
ogsf run-heroic "add a /health endpoint"
ogsf run-normal requests/health.md
ogsf attack-var "implement the plan" --match-id a1b2c3d4
ogsf scout-opposition "where is auth handled" --config set_pieces/boardroom/frontier.config.yaml
```

The prompt is inline text or a file path. Launch in the background so you can watch while it works; the `match_id` is printed on the first line (`match_id: a1b2c3d4   founder …`) — capture it, everything else keys off it.

Flags every set piece takes:

| Flag | Meaning |
|---|---|
| `--config <path>` | the club config (default `$CLUB_CONFIG`, else `set_pieces/boardroom/club.config.yaml`) |
| `--match-id <id>` | join or pin a match id |
| `--skip-kickoff` | `run-heroic` and `run-mythic` only: dispatch even when the kickoff checklist refuses |
| `--player <name>` | `ask` only: who answers (default `builder`) |
| `--base <ref>` | `bard` only: the ref the change is measured against (default `main`) |

### Listen for the roster

The set piece says *what runs*; the config says *who runs it*. **If the founder references a roster, a config or a model tier, pass it — do not fall through to the default.** Rosters are the founder's to add, rename and retune, so read them from disk every time:

```bash
ls set_pieces/boardroom/*.config.yaml
grep -nE '^\s*- name:|^\s*model:' set_pieces/boardroom/<name>.config.yaml   # who, on which model
```

They will rarely say `--config`. Treat any of these as naming a roster, then resolve it to a file:

| What they say | What it means |
|---|---|
| "run it on the frontier config", "use the frontier roster" | the config file whose name matches |
| "run this with the big models" | the non-default roster — confirm which if there is more than one. A config's header comment says what it is for, so `head -3` settles it |
| "have opus plan this one" | a roster whose playmaker is that model; if none exists, say so rather than editing the config mid-request |
| nothing about models at all | the default, `set_pieces/boardroom/club.config.yaml` |

`--config` takes the path directly; `CLUB_CONFIG=<path>` does the same for every command in a shell.

Two things that bite:

- **Never swap rosters on your own.** A different roster is a different cost and a different result. If the default's model looks wrong for the work, say so and let the founder choose.
- **Switching rosters mid-match breaks resumption.** `club_sessions.json` records the model each club session was created with, so a joined match (`--match-id`) whose config now names a different model starts that player **fresh** instead of resuming its context window. That is deliberate — a bad resume is worse — but "plan on the frontier roster, then build on the default" costs the builder its accumulated context. Say so when you report it.

### Joining a match

`--match-id` is optional on **every** set piece. Given one, the match joins that id if it exists or is created under exactly that id: same `matches/{match_id}/` directories, same torch pass, objectives continue their sequence, and each player resumes its existing club session. That is how set pieces chain — `team-talk` under one id, then `attack-var` under the same id. The torch pass then holds the playmaker's `plan.md`; the safety officer reads it as the spec, and the builder needs the prompt to point at it ("implement the plan in the torch pass"), because a set piece that starts at build hands its builder no previous report.

**On `run-mythic`, a reused id is different.** If that match's last result was a failure (not accepted), `run-mythic --match-id <id>` re-runs the strict qa gate once (`qa_rerun`) on the repaired tree: no players, no extra time, no empty commit. Use a fresh id for a new implementation.

## The kickoff checklist

`run-heroic` and `run-mythic` refuse a match before it spends a token when the checklist fails, and print every check:

- the working tree is clean (skipped when resuming: a resumed match left its tree dirty on purpose);
- HEAD is not `main`, `develop` or `release/*` — the spec commit would land on a base branch;
- for a prompt that is a file under `specs/<name>-quests/`: the branch is `feature/<spec file stem>`, the spec is committed and unmodified, no merged PR came from that branch (`gh`, skipped when offline), the contract's `difficulty` names this set piece, and its `precondition` exits 0 — the spec's own proof that work remains.

An inline prompt gets the hygiene checks only. `--skip-kickoff` dispatches anyway; use it only when the founder knows why each failed check is wrong.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | the match was accepted (touchdown) |
| 1 | an objective was lost, the match was not accepted, or an error stopped it — read the summary panel and `ogsf passages <id>` |
| 2 | the kickoff checklist refused the dispatch: nothing ran, no tokens spent |
| 75 | **match abandoned**: the model provider refused (no credits, a rate limit, an outage). Nothing judged the work wrong and nothing was committed. Running again needs the provider to answer; which account pays is the founder's decision |
| 128 + n | stopped by signal n (130 for Ctrl-C, 143 for SIGTERM): the match records itself as a turnover and closes its process rows |

## Report

Tell the founder, in order: which set piece and which roster you launched (name the config whenever it was not the default), which objective is running now (or which failed), objective statuses in sequence, and for a failure the official-review violations or the error verbatim. Remember **every objective is a turnover until it earns a touchdown** — `running` means still in flight, `queued` means never started. Don't dress up a partial match as a success. For watching, diagnosing and stopping, load `observe.md`.
