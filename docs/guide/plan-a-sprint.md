# Plan a sprint

Write the week's work as tickets with dates, mark the ones the fleet may
start by itself, and leave the Scheduler running. This page walks through
it; the format in full is on [Upcoming Matches](../upcoming.md).

## 1 · Write the tickets

Create `set_pieces/upcoming/sprint-14.md` (any name ending in `.md`):

```md
---
sprint: Sprint 14
timezone: Europe/London
---

# Sprint 14

Goal: the timer ships, and the contact form is lint-clean.

## KICK-7 · Where is the match clock rendered?
date: 2026-10-19
set piece: scout-opposition
mode: auto

Find every component that renders the match clock and how it gets the time.

## KICK-8 · Add a match timer
date: 2026-10-20
time: 09:30
set piece: run-heroic
mode: auto

Add a match timer: start, stop, and minutes played on /timer.
Keep the existing styles.

## KICK-9 · Review the timer with the team
date: 2026-10-21
set piece: ask
player: safety_officer

Read the timer change and list anything a reviewer should look at first.
```

- `mode: auto` lets the Scheduler start the ticket when it is due. Leave
  `mode` out (or write `manual`) for tickets a person should start.
- A ticket with a date and no `time` is due at `upcoming.default_time`
  (09:00 unless you change it).
- Commit the file: tickets are part of your repository, like specs.

Check that every ticket reads:

```sh
ogsf upcoming
```

It lists each ticket with its due time and status, and names any ticket it
could not read, with the reason (a missing `date:`, a set piece that does
not exist, a duplicate id).

## 2 · Run the Scheduler

```sh
ogsf scheduler
```

Every 30 seconds (`scheduler.poll_seconds`), and straight away after a
match ends, it re-reads the tickets and starts at most one match: the
earliest `auto` ticket that is due. Leave it running in its own terminal,
or under `tmux`, on the Mac that should do the work. Ctrl-C stops it at
once: a match in progress gets the same signal and is recorded as a
turnover, like any match stopped by a signal, so stop it between matches
when you can.

`ogsf scheduler --once` does one round and exits, which is handy to test
your tickets, or to run from `cron` instead of keeping a process alive.

A **manual** ticket waits for you:

```sh
ogsf upcoming run KICK-9
```

## 3 · Keep the branch in mind

The Scheduler runs a ticket in the repository as it is: on the branch you
have checked out. Two consequences:

- `run-heroic` and `run-mythic` tickets pass the kickoff checklist first,
  so they need a clean tree on a feature branch, and a `run-mythic` quest
  needs the branch named after its spec (`feature/<spec file name>`). If the
  checklist refuses, the ticket is marked with the reason and nothing runs.
- Plan tickets that build on each other for the same branch, or switch
  branches between them yourself.
- A `run-mythic` ticket's `spec:` file must exist when the ticket is read.
  One whose spec is not written yet is marked `skipped` with a note, never
  launched; write and commit the spec, then `ogsf upcoming run <id>`.

## 4 · Watch it

Matchday Live's **Upcoming Matches** section (`#/upcoming`) shows every
ticket by due time with its status, and links each one to the match that
played it. With a relay set up, the cloud page shows the same list, so you
can check on the sprint from your phone.

## 5 · Let the Claude app add work (optional)

To let requests from the page or the Claude app run on this Mac, opt in:

```yaml
scheduler:
  accept_remote: true
  allowed_set_pieces: [ask, scout-opposition, team-talk]
```

A request by set piece name runs only if its set piece is listed there; a
request for one of your tickets may run whatever the ticket says. See
[Connect the Claude app](claude-app.md).

## Linear

Reading tickets from Linear is designed for and arrives later
([Linear](linear.md)). Until then, Markdown tickets are the source.
