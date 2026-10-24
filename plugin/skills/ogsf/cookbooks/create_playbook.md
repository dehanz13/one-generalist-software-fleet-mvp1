# Create a playbook

A playbook is a chain of players written as data: each player's match report is handed to the next. It is how the founder adds a chain without touching Go — the set pieces are compiled into `ogsf`, a playbook is a YAML file the binary runs with `ogsf play`.

## Step 1 — Design the chain

Answer four questions, in order:

1. **What players, in what order?** Pick from the roster (`set_pieces/boardroom/club.config.yaml`). The starter five cover most chains:

| Player | Use when | Report type | Its official review in a playbook |
|---|---|---|---|
| `ranger` | you need to FIND something first — read-only recon | `AnalystReport` | `ball_in_play` |
| `playmaker` | the work needs a plan before code changes | `TalkReport` | `ball_in_play` |
| `builder` | code must change | `AttackReport` | `ball_in_play` |
| `safety_officer` | the change must be confirmed to BE what was asked for | `VarReport` | `ball_in_play` |
| `bard` | finished work needs a write-up | `BardReport` | `ball_in_play` |
| any other player in the config | a one-off role | `GenericReport` | `ball_in_play` |

   A new kind of player needs a config entry and a team-talk pair first — see `update_config.md` and `update_team_talks.md`.

   **The suite and the safety officer answer different questions.** "Does it run" is a test, and code can ask that. "Is this the thing that was asked for" is a review, and only a player can. A green suite over a feature nobody requested is still a failed request, and neither one covers for the other.

2. **Does code have to act?** Running the qa checks, capturing a diff, committing — those are referee objectives, and a playbook has none: it is players only, report to report. If the chain needs a test loop, a commit, a scope check or a write-up from a diff, use a set piece that already does it (`run-normal`, `run-heroic`, `run-mythic`, `bard`) or add one in Go (`add_set_piece.md`).

3. **Does anything loop?** A playbook runs each step once. Bounded repair loops (extra time) and review loops live in set pieces, as code.

4. **What does each step need to prove?** Every playbook step gets `ball_in_play`: every artifact the player declares must exist. Stronger reviews (`replay_matches_report`, `decision_stands`) belong to set pieces.

## Step 2 — Write it

```bash
ogsf write-playbook --name review_docs --players ranger,builder
```

Writes `set_pieces/playbooks/review_docs.yaml`: one step per player, in order, each handing its report to the next. It does NOT create config entries or team talks — do that first, or validation stops the match before anything spawns and names what is missing. `--force` overwrites an existing playbook.

```yaml
name: review_docs
description: "ranger → builder"
steps:
  - player: ranger
    description: Find every README section that is out of date, and say where each is wrong
  - player: builder
    description: Rewrite the sections the ranger named, and nothing else
```

## Step 3 — Earn every description

**Replace each generated `description`.** The step's player names it; the description explains it — what this objective does and why, in one sentence. It is the only line of intent the record, the console and Matchday Live ever show. A description that only restates the objective's name is refused when the match starts, before the objective opens.

The objective is named after its player (`ranger`, `builder`); a player used twice gets `_2`, `_3` (`builder_2`).

## Step 4 — Run it

```bash
ogsf play review_docs "make the README say how to run the server"
ogsf play set_pieces/playbooks/review_docs.yaml "…"    # a path works too
```

It opens with the founder's `ask` objective, like every set piece, runs each step, and finishes accepted when every objective earned a touchdown.

## Before the founder relies on it

1. Run it on a tiny real request and watch it go green end to end (`ogsf passages <match_id>`).
2. Read the final `match_report.json` of each player — is each report earning its fields?
3. If two players keep fighting through the hand-over, the problem is usually a team talk, not the chain (`update_team_talks.md`).
