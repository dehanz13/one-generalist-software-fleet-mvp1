# Reports and what they measure

A single match tells you whether one piece of work landed. Reports answer
the questions you can only ask across many: which player costs the most,
which one needs correcting, whether a cheaper model would do, and where the
time goes. Matchday Live has two: the **daily report** (`#/days`) and the
**multi-day report** for any period (`#/report?from=<date>&to=<date>`), and
both download as PDF or Markdown. The Claude connector answers with the
same Markdown.

Every report is computed from the same rows, by the same code
(`shared/report.ts`), on the page and in the connector, never in SQL. So a
report of the demo, of your Mac, and of the cloud agree by construction.

## The measures

### Outcomes

| Measure | What it counts | Why it is useful |
|---|---|---|
| matches · touchdowns · turnovers | matches by how they ended | the headline |
| abandoned | turnovers the provider caused (exit 75) | not a verdict on the work; keep them out of quality judgements |
| touchdown rate | a player's objectives that ended in a touchdown, out of all its objectives | the plainest sign a player is up to its job |
| first-try rate | objectives that passed with **no** corrected reply and every review green on the first attempt | the honest one: a touchdown after two corrections still cost three turns |
| extra time | objectives spent in `iterate_*` and `revise_*` | how often the first build was not good enough |
| corrected replies | replies that did not parse as the report asked, each corrected in the same session | a team talk that is unclear, or a model that struggles with the format |
| breaches | writes outside a player's fence, rolled back | should be zero; if not, read that player's team talk |
| not accepted | every objective passed, but the set piece's own test did not | the suite or the review stayed red |

### Tokens, three ways

Token counts are easy to misread, so a report shows them three ways:

- **Read**: input tokens plus cache *writes*: raw material the model read
  for the first time.
- **Written**: output tokens: what it generated. Reasoning (thinking) is a
  share *of* output, never added to it.
- **Billed**: what the provider counted, which re-counts cached context on
  every turn. A long session can bill many times what it read, mostly as
  cheap cache reads.

That is why **cache share** matters: cache reads ÷ (input + cache reads +
cache writes) for a player. A high share means most of its context was
served from cache, at a fraction of the price. It is also the quiet payoff
of correcting a reply *in the same session*: the context is still cached.

**Peak context** is the fullest a player's context window got (context
tokens ÷ window size). A player that runs near 100% is one long task away
from losing what it read at the start.

### Cost

Cost per match, per player and per objective, from the cost each club
reports. A player whose **cost per objective** is high and whose first-try
rate is low is the first place to look for savings.

## Per player, from the demo recording

These two charts are drawn live from the demo recording bundled with the
page (`public/demo/matchday-demo.json`), through the same report code as
every report. The recording is scripted, so its numbers show the shape of a
real report, not a real bill.

<!-- chart: cost-by-player -->

<!-- chart: tokens-by-player -->

On GitHub these charts do not render: open the Docs on any Matchday Live
deployment (or `ogsf var`) to see them, or open the multi-day report on the
demo with `?demo`.

## Where the time goes

Before the Go version was written, 32 strict runs of the Python factory
were measured. Building took 55% of the run time, planning 22% and
verifying 13% (source: `wiki/GO-MIGRATION.md`, section 5). The source does
not break down the remaining 10%.

<!-- chart: time-split -->

| Share of run time (32 strict runs) | |
|---|---|
| building | 55% |
| planning | 22% |
| verifying | 13% |
| the rest (not broken down in the source) | 10% |

The lesson the migration drew from it: that time is models thinking and
tests running, so a faster language does not make a match faster. Go buys
one file to install, clean control of child processes, and less that can go
wrong at the edges. If you want faster matches, the levers are the ones the
reports show you: a cheaper or faster model where first-try rates allow it,
fewer corrections, and less extra time.
