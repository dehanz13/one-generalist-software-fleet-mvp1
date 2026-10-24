# Safety and checks

The fleet lets models change your code. Everything on this page exists
because a model, at some point, did something it was not asked to: deleted
a plan it found "unexpected", reverted the very check it was about to be
judged by, or carried on building for minutes after the planner already
knew there was nothing to build. Each check below is the answer to one of
those moments, and each one is plain code.

## What players can and cannot do

Be clear about the starting point: **players run with your shell's
permissions.** A player with `bash` can run any command you could. OGSF does
not sandbox that. What it does instead is check, after every player call,
what actually changed, and undo what should not have.

- `tools` is a capability list, not a fence.
- `writes` (per player) and `restricted_area` (for everyone) are the fence,
  enforced after the fact.
- Contract checks and qa commands are shell commands from your config and
  your specs. **Read a repository's `set_pieces/boardroom/club.config.yaml`
  before you run its set pieces**, the same way you would read a Makefile.
- Every command has a time limit, and a limit stops the command's whole
  process group, not only the parent.

## The restricted area

Before a player runs, the match fingerprints every path the working tree
differs on. After it runs, it compares. Any path that appeared, vanished or
changed is checked against what that player may change:

1. the match's own runtime folder (`set_pieces/clubhouse/matches/…`), which
   every player may always write, so even a read-only player can hand back
   its report;
2. the player's own `writes:` list;
3. never the `restricted_area` (by default `set_pieces/boardroom/` and
   `set_pieces/playbooks/`), unless the player names it in its own `writes`.

A path outside that is rolled back, and the objective fails with every path
named. Comparing change-sets, rather than watching writes, catches the
subtle case: a file that was modified before the call and is clean after it
has been *reverted*, and a reversion is a modification.

Why is there no correction for this, when there is one for a bad report?
Because a correction asks a player to redo its work. A write outside the
fence has already happened; the honest response is to undo it and say so.

## qa and the progressive gate

`qa.checks` in the config lists the commands that judge the code: by
default `npm run lint`, `npm run typecheck`, `npm run test` and
`npm run build`, each with a time limit. They run in the order listed (fast
first, by convention), and a build waits while any typecheck is failing,
because the build would run the same typecheck and cannot pass.

There are two ways to judge them:

- **Strict**: every check must exit 0. `ogsf qa` and the test objectives of
  `run-normal` and `run-heroic` work this way.
- **Progressive**: used by `run-mythic`. A check that names a `diagnostics`
  parser (`eslint` or `tsc`) passes if it introduced **no new problem**
  compared with the line of scrimmage, the measurement taken before the
  build. Tests and build still need a clean exit.

A *problem* is identified by its file, rule and message, and counted, so a
second copy of an existing problem is a new problem. An equal total with
different problems is red. That is what makes a large clean-up possible one
quest at a time: each quest is judged on whether it moved the codebase
forward, not on whether it fixed everything at once.

<!-- chart: progressive-gate -->

| Case | Before (line of scrimmage) | After | New problems | Gate |
|---|---|---|---|---|
| a quest that only removes problems | 847 | 721 | 0 | green |
| same total, one problem swapped for another | 847 | 847 | 1 | red |
| fewer in total, but one new | 847 | 800 | 1 | red |

The 847 → 721 case is the example the gate's own console line uses
(`lint: 847→721 (-126)`, in `backroom_staff/qa/qa.go`); the other two rows
apply the rule from the same file to the same starting count.

The parser refuses output it does not recognise: a crash must never be
counted as zero errors. A check with no parser is judged on its exit code
alone, in both modes.

## The quest contract

A spec is prose for players, and prose cannot refuse anything. So a quest
spec may carry one fenced block the harness reads itself:

````md
```ogsf
difficulty: run-mythic      # the set piece this quest must run under
precondition: |             # exit 0 = work REMAINS. Run before any player.
  test "$(npx eslint components/contact --format json | jq '[.[].errorCount]|add')" -gt 0
writes:                     # every path the match may change
  - components/contact/*
checks:                     # must exit 0 on the built tree, before the gate
  - name: touched files are lint-clean
    run: git diff --name-only HEAD -- '*.test.tsx' | xargs npx eslint --no-warn-ignored
```
````

Each field exists because of something that went wrong without it:

| Field | Why |
|---|---|
| `difficulty` | a spec once named a difficulty that ran tests only, for a quest judged on its lint count |
| `precondition` | a quest was dispatched a second time after it had already merged |
| `writes` | the safety officer was the only scope check, and a judgement is not a glob |
| `checks` | an acceptance criterion written as prose is checked by whoever remembers to |

A spec with no block is still valid. Everything treats a missing block as
"nothing declared" and says so, rather than reporting a pass it did not
earn.

## The kickoff checklist

`run-heroic` and `run-mythic` run the kickoff checklist before anything
else, against the prompt exactly as you typed it:

| Check | Applies to |
|---|---|
| working tree clean: nothing stray would ride along in `git add -A` | every kickoff |
| on a feature branch, not `main`, `develop` or `release/*` | every kickoff |
| spec matches branch: the quest's file name and the branch agree | a prompt under `specs/*-quests/` |
| spec committed: tracked and unmodified | a quest spec |
| quest not already merged (asks `gh`; skipped if `gh` is missing) | a quest spec |
| the contract's difficulty, and its precondition says work remains | a quest spec with a contract |

A refusal exits with code 2 and spends nothing. `--skip-kickoff` overrides
it when you know better, and is recorded.

## The ruling stop

The playmaker is the first player to look at the tree, and its
`TalkReport` carries a ruling: `implement`, `noop` (already done) or
`blocked` (cannot be done as asked). In `run-mythic`, anything but
`implement` ends the match at the spec. The plan's copy under `specs/` is
removed (it describes no work), the record keeps it in the torch pass, and
the exit code is 1, because a quest that produced nothing is something you
need to see.

## Match abandoned

When the model provider fails (no credits left, a rate limit, an outage),
the objective is still recorded as a turnover, but the match exits with
**75** instead of 1 and says plainly that no review was red. A provider
error is not a verdict on the work, and a script that dispatches quests in
a row needs to tell the two apart.

## The commit normaliser

Every set piece that ships passes its commit header through `commitmsg`,
which makes it parse under `@commitlint/config-conventional`: a type, a
lower-case subject, no trailing period, a sane length. Players do not
reliably write conformant headers, and failing a match at its very last
step, after every check passed, over a capital letter would be absurd.
When an `iterate` changes the story, the fuller message is kept rather than
replaced.

## What the cloud can see

- `ogsf var` listens on `127.0.0.1` only, and answers another origin only
  when you allow it with `--allow-origin`.
- The relay sends to the URL in your `.env`, with a revocable fleet token,
  and nothing else. The page never sees your provider keys: the fleet never
  had them.
- Matchday Live's secrets live only in Vercel's environment; see
  [Matchday Live](matchday-live.md#security).
