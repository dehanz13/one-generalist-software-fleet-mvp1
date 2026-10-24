# Your first real match

Start small. The first match should be cheap, read-only and quick, so that
if a key or a model name is wrong you find out for a few cents. Then make a
real change on a branch.

## 1 · A cheap, read-only match

```sh
ogsf ask "In two sentences, what does this repository do?" --player ranger
```

`ask` is one objective for one player. The ranger runs on a small model and
may change nothing in the repository, so this is about as safe and cheap
as a match gets. You will see the match id, the player starting, its tool
calls as they happen, and a closing banner with the answer, the tokens and
the cost.

If it fails straight away, the message says why: a missing key, a model
pi cannot resolve, or a player the config does not define. See
[troubleshooting](troubleshooting.md).

## 2 · Look at what happened

```sh
ogsf matches                     # the last ten matches
ogsf passages <match_id>         # its objectives, in order
ogsf var                         # Matchday Live on http://127.0.0.1:4600
```

`ogsf var` opens Matchday Live in your browser, reading this Mac's match
log. Open the match and look at three things: the **lanes** (one per
player, with each tool call on it), the **objective panel** (the report the
player handed back, the reviews it passed, and the exact team talk it was
sent), and the **cost and tokens** on the scoreboard. Leave `ogsf var`
running in its own terminal: every match you start from now on appears on
the page as it plays.

## 3 · A plan, without building

Pick something small and real you want done, and ask for a plan first:

```sh
git switch -c feature/health-endpoint
ogsf team-talk "Add a /health endpoint that returns {ok: true} and the app version."
```

The playmaker writes a spec under `specs/` and stops. Read it. If it
misunderstood you, it is much cheaper to find out now, and the fix is to
say more in your request, not to argue with the build afterwards.

## 4 · Build it, tested and committed

```sh
ogsf run-normal "Add a /health endpoint that returns {ok: true} and the app version."
```

`run-normal` plans, builds, runs your test checks, gives the builder up to
three rounds of extra time if they are red, and commits only a green
result. Watch it on Matchday Live. When it ends:

```sh
echo $?          # 0 accepted, 1 not accepted, 75 the provider stopped it
git log -1       # the commit it made, with a Conventional Commits header
```

A turnover is not a disaster: the match's record says exactly which
objective failed and why, and nothing unverified was committed. Read
`ogsf passages <match_id>`, or run `ogsf post-match <match_id>` to have the
ranger read the whole record and suggest what to change.

## 5 · The full difficulty

When the work is real and its shape is not obvious, use `run-heroic`. It
needs a clean tree on a feature branch (the kickoff checklist checks):

```sh
git switch -c feature/match-timer
ogsf run-heroic "Add a match timer: start, stop, and minutes played on /timer."
```

You get three commits (the spec, the code after a green suite and the
safety officer's approval, and the bard's write-up), or, if the suite or
the review never come clean, only the spec commit and a clear reason.

## Writing a good request

The playmaker can only plan what you wrote. A request that works well:

- says **what** and **where**: "on /timer", "in the settings page";
- says what **done** looks like: "shows minutes played", "returns 404 for an unknown id";
- names **constraints**: "keep the existing styles", "no new dependencies";
- is **one thing**. Two features are two matches.

A long request can live in a file: `ogsf run-heroic specs/timer.md` reads
the file as the prompt.

## Next

- Make the fleet fit how you work: [your own workflows](your-workflows.md).
- Plan a week of work and let it run: [plan a sprint](plan-a-sprint.md).
