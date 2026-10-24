# OGSF docs

How the One Generalist Software Fleet works, and how to use it for your own
work. The same pages are built into Matchday Live (the **Docs** and
**Guide** sections), with charts drawn from live data.

OGSF is built on [Super Simple Software Factory](https://github.com/disler/super-simple-software-factory)
by IndyDevDan (MIT). The design is his: plain code owns the order of work,
and agents are bounded steps inside it.

## Docs: how it works

1. [What OGSF is](overview.md): the idea, the credit, the vocabulary
2. [The components](components.md): every part, and one match as a sequence
3. [The set pieces](set-pieces.md): all thirteen, when to use each, the difficulties, exit codes
4. [Players, clubs and match reports](players.md): roles, models, reports, official reviews, corrections
5. [Safety and checks](safety.md): the restricted area, qa and the progressive gate, the contract, the kickoff checklist
6. [The match log](match-log.md): the tables, the events, the API
7. [Matchday Live](matchday-live.md): the sections, the sources, the relay, Supabase, security
8. [Reports and what they measure](measures.md): touchdown and first-try rates, tokens three ways, cost
9. [Upcoming Matches and the Scheduler](upcoming.md): tickets, requests, who may start work
10. [Remote control](remote.md): Claude Code Remote Control and the Matchday Live connector

## Guide: step by step

1. [Install and set up](guide/install.md)
2. [Your first real match](guide/first-match.md)
3. [Your own workflows](guide/your-workflows.md): playbooks, quests with a contract, new players
4. [Plan a sprint](guide/plan-a-sprint.md): tickets and `ogsf scheduler`
5. [Matchday Live in the cloud](guide/matchday-live-cloud.md): Vercel, Supabase, connecting each Mac
6. [Connect the Claude app](guide/claude-app.md): both ways
7. [Linear (coming later)](guide/linear.md)
8. [Troubleshooting](guide/troubleshooting.md)

## Diagrams

Every diagram is a real Excalidraw scene (`diagrams/*.excalidraw`),
exported by Excalidraw itself. [diagrams/README.md](diagrams/README.md)
explains how to edit and re-export them.
