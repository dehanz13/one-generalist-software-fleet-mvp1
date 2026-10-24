# Upcoming Matches

Planned work for this project: one markdown file per sprint (or per week,
or one file for everything), each holding tickets with the day they are to
be worked. This README is never read as a ticket, so its example below is
safe to keep.

`ogsf upcoming` reads every `*.md` file here and lists the board.
`ogsf upcoming run KICK-7` plays one ticket now.
`ogsf scheduler` runs on the Mac that does the work and starts each `auto`
ticket when it is due, one match at a time.
Matchday Live shows the same board under **Upcoming Matches**.

The sources are set in `boardroom/club.config.yaml` under `upcoming:`.
Linear is planned as a second source; markdown is the one that works today.

## The format

```markdown
---
sprint: Sprint 14
timezone: Europe/London
---

# Sprint 14 · 12–23 October

Anything outside a ticket, like this line, is ignored.

## KICK-7 · Add a dark mode toggle
date: 2026-10-14
time: 10:30
set piece: run-heroic
mode: auto

Add a toggle to the header that switches between the light and dark
themes and remembers the choice. Cover it with a test.

## KICK-8 · Where is the session cookie set?
date: 2026-10-15
set piece: ask
player: ranger

Find where the session cookie is set and list every place that reads it.

## KICK-9 · Build the export from its spec
date: 2026-10-16
set piece: run-mythic
spec: specs/kick-9.md
```

- **Front matter** (optional): `sprint:` names the group on the board;
  `timezone:` is the zone the dates are read in (default: the config's
  `upcoming.timezone`, else this Mac's).
- **A ticket** is a level-2 heading, `## ID · Title`, where ID looks like
  `KICK-7` (letters, a dash, a number; `-`, `–`, `—` or `:` work in place of `·`).
- **Its fields**, one per line straight under the heading:
  - `date:` YYYY-MM-DD, required: the day it is to be worked.
  - `time:` HH:MM, optional: default `upcoming.default_time` (09:00).
  - `set piece:` required: the command that works it, such as `ask`,
    `team-talk`, `run-heroic` or `run-mythic`.
  - `mode:` `auto` (the Scheduler starts it when due) or `manual` (the
    default: a person starts it, here or on Matchday Live).
  - `player:` for `ask`: who answers.
  - `spec:` a quest spec path, used as the prompt (for `run-mythic`).
  - `timezone:` this ticket only.
- **The prompt** is everything after the blank line that ends the fields,
  up to the next ticket.

A ticket keeps its status once it has run: editing a played ticket does not
play it again. Removing a ticket that never ran marks it skipped on the board.

## Who may start work

An `auto` ticket runs when it is due because you wrote it in your own
repository. Requests from Matchday Live, the Claude connector or
`ogsf request` run only when `scheduler.accept_remote: true`, and a request
by set piece name only for the set pieces in `scheduler.allowed_set_pieces`.
Every match still passes its kickoff checklist.
