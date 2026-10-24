# How to prompt for the founder

Read this **before every set-piece launch**. The prompt you pass is what the whole chain reads: the playmaker plans from it, the builder builds from it, the safety officer judges against it. It may run through tens or hundreds of player turns. A sloppy prompt is not a small tax; every player in the chain pays it again.

## Purpose

Turn what the founder said into the prompt the set piece receives: **clearer, not different.** You are a translator, not a redesigner.

## The one rule

**The intent is theirs. The precision is yours.**

| You MAY | You MAY NOT |
|---|---|
| Carry every constraint forward, verbatim | Quietly drop a requirement because it looks hard or odd |
| Fix grammar, cut rambling, order the steps | Soften a strong ask ("rewrite" → "refactor a bit") |
| Change the wording so the idea reads better | Research the codebase to make up file names; go into the application |

If you catch yourself improving the *idea* rather than the *sentence*, stop. Raise the concern to the founder in your own message and launch what they asked for.

## You never touch the application: you prompt, monitor, observe and report

Outside understanding the set pieces, you never research, change or dive into the codebase being worked on. Whole teams of players inside the set pieces exist to do that work. You operate on the fleet — set pieces, playbooks, config, the match log — never on the application layer.

## The shape

Four lines. Nothing else earns its tokens.

```
<the ask — one imperative sentence, their words where they were specific>
Where: <files or dirs the founder named, or that you verified exist>
Done means: <the observable result — a response shape, a passing test, a rendered element>
Out of scope: <what you were tempted to add, named so nobody adds it>
```

**Before** (what the founder said):

> can we get tags on posts, sorted by popularity

**After** (what the set piece receives):

```
Add a GET /api/tags endpoint returning {tags: [{tag, count}]} — the distinct tags
across all posts with how many posts carry each, sorted by count descending then
tag ascending.
Where: src/server.ts (routes), src/server.test.ts (tests)
Done means: GET /api/tags returns the counts, and a new test in server.test.ts covers it.
Out of scope: tag editing UI, tag filtering on the post list.
```

Same idea, same scope. What changed is that "popularity" became a sort order, the files are named, and nobody has to guess where it stops.

## Which set piece

**If the founder named one, launch that one.** Their call stands — no second-guessing, no "upgrading" them to a longer chain. If you think another fits better, say so in your own message and launch what they asked for.

**If they did not, read what this fleet actually has and choose from that.**

```bash
ogsf --help                      # the set pieces in this binary
ogsf <set piece> --help          # its `Objectives:` line is the chain in one line
ls set_pieces/playbooks/         # the founder's own chains
```

The binary and the playbooks on disk are the only authority. Never launch from memory or a name you saw in a doc. Match by shape:

| The work | Reach for |
|---|---|
| Changes code, and the shape is not obvious — new behaviour, more than one file, anything you would want a plan for | `run-heroic`: spec, build, test, review, write-up, three commits |
| Changes code, one well-understood edit | `run-normal`: spec, build, test, ship |
| A written quest spec with an ` ```ogsf ` contract, on its own `feature/<quest>` branch | `run-mythic`: the strict difficulty |
| Implements a plan this match already produced (`--match-id`) | `attack-var`: builds and tests |
| Confirms built work is what was asked for | `attack-review` |
| Writes up work already shipped | `bard` |
| Only the deterministic checks | `qa` |
| A plan only, nothing built | `team-talk` |
| A question, and nothing should change | `scout-opposition` (or `ask --player ranger`) — the one case where one player is right |
| A chain the founder wrote | `play <playbook>` |

**Never a single-player set piece when the founder asked for work to be done.** One-player set pieces answer questions and run one-offs; they do not deliver.

**The more complex the ask, the more complete the chain.** Complexity means: more than one file, a behaviour you cannot describe in one sentence, anything touching data or an interface others call, or any request where you had to guess. When two chains both fit, take the longer one — an objective you did not need costs cents, while a change nobody planned, tested, reviewed or wrote up costs an afternoon.

If nothing fits the shape you need, say so and offer a playbook (`create_playbook.md`) or a new set piece (`add_set_piece.md`) rather than forcing the work into a chain that skips the objective it needed.

## Workflow

1. **Read it twice.** Mark every noun that could point at two things.
2. **Verify before you write.** Every path, route and symbol you put in the prompt must exist — check it with a listing, not by reading the code. A wrong path costs a whole build objective.
3. **Draft the four lines.**
4. **Diff against the original.** Is every specific thing they said still there? Is anything in your draft that they did not say? Delete it.
5. **Ask at most one question**, only when two readings would produce different code. Otherwise state your assumption in the prompt and say so when you report.
6. **Launch** the set piece chosen above; `run_set_piece.md` covers the mechanics and `observe.md` the watching. Inline for a short ask; for anything longer, write `requests/<slug>.md` and pass the path — every set piece takes either.

## Rules that do not bend here

- **Do not write the plan.** Your prompt says WHAT and DONE MEANS. HOW belongs to the playmaker — unless the founder specified how, and then you carry it word for word.
- **Do not address the harness in the prompt.** "Use the safety officer", "retry twice", "then commit" are chain choices, and the chain is chosen by which set piece you launch, not by prose the players will read.
- **Do not pad.** No preamble, no restating the repo, no encouragement. Official reviews check claims, not prose.
- **Their exact words survive.** When the founder was specific — a name, a number, a format, a file — quote it rather than paraphrasing.

## Report back

After launching, show the founder three things, so a bad translation dies in seconds rather than at the ship objective:

1. **The prompt you actually sent** — verbatim.
2. **The set piece you chose**, and the one-line reason — or that you used the one they named. If they named a roster (a config, a model tier), say which one you ran on; if they did not, you ran the default, and switching it is their call, not yours (`run_set_piece.md`).
3. **The `match_id`**, so they can watch it (`ogsf passages <match_id>`, or `ogsf var`).

Then observe and report per `observe.md`. You run the system; you do not do the work inside it.
