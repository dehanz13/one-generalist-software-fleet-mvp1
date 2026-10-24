# Update a playbook

Change an existing playbook in `set_pieces/playbooks/<name>.yaml`: add, remove or reorder steps, or sharpen their descriptions. The file is the founder's: edit it by hand.

## Add a step

Insert a `- player: <name>` step where it belongs, with its description:

```yaml
steps:
  - player: ranger
    description: Locate the code the request touches, so the builder starts in the right files
  - player: builder
    description: Implement the request in the files the ranger named
```

The player must exist in the config with both team talks on disk; validation fails the match at startup otherwise, before anything spawns, so a typo never dies mid-match.

`description` must earn its place: one sentence on what the step does and why. A blank one gets a generated default, which says nothing; one that only restates the objective's name is refused before the objective opens.

## Remove a step

Delete it, and re-read the hand-over: whatever the removed step produced was the next step's `previous_report`. The next player now receives the report of the step before it, which may be a different report type with different fields. Check that its team talk still makes sense of what it receives.

## Reorder steps

Order is the chain. Each player receives the report of the step directly before it — never of earlier ones — so put the player whose findings the next one needs immediately before it. Bulky context moves through the torch pass: a player writes a file there and declares it in `artifacts`; the next player reads it.

## What a playbook cannot do

A playbook is players only, each run once, report to report, each step reviewed by `ball_in_play`. When a change needs any of these, it has outgrown a playbook — use or add a set piece (`add_set_piece.md`):

- a qa check, a scope check, a diff capture, or a commit (referee objectives);
- a bounded repair loop (extra time) or a revise loop;
- a stronger official review on one step;
- an acceptance rule beyond "every objective earned a touchdown".

## After the change

Run it once on a small real request (`ogsf play <name> "<prompt>"`) and read `ogsf passages <match_id>`: every step present, in order, each a touchdown.
