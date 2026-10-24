# OGSF plugin for Claude Code

The Claude Code plugin for One Generalist Software Fleet. It teaches Claude to run, observe and extend the fleet through the `ogsf` binary: launch set pieces, write playbooks, retune players, and read matches in the match log or on Matchday Live. Its skill appears as `ogsf:ogsf` (type `/ogsf:ogsf`, or just ask about the fleet).

Built on [Super Simple Software Factory](https://github.com/disler/super-simple-software-factory) by IndyDevDan (MIT). The design is his: plain code owns the order of work, and agents are bounded steps inside it. Danniel's additions are the kickoff checklist, the quest contract, the ruling as a stop, the progressive qa gate, the commit normaliser, match abandoned (the provider stop) and the spec tools.

## What it contains

```
plugin/
├── .claude-plugin/plugin.json      the manifest (name: ogsf)
└── skills/ogsf/
    ├── SKILL.md                    the orchestrator: startup, rules, routing
    ├── cookbooks/                  one procedure per request, loaded lazily
    │   ├── overview.md             the system map (read at startup)
    │   ├── incorporate.md          put the fleet into a repository; first runs
    │   ├── how_to_prompt_for_the_founder.md   turn a request into a set-piece prompt
    │   ├── run_set_piece.md        which set piece, flags, exit codes, the kickoff checklist
    │   ├── observe.md              matches, passages, live feed, on pitch, highlights, post-match, Matchday Live, the relay
    │   ├── create_playbook.md · update_playbook.md   chains of players, as data
    │   ├── onboard.md · update_config.md            the club config
    │   ├── update_team_talks.md    what a player is told
    │   ├── add_set_piece.md        contributors: a new set piece, report type or official review in Go
    │   ├── upcoming_matches.md     tickets, a sprint, ogsf scheduler, requests
    │   ├── performance.md          daily and multi-day reports, player performance, PDF and Markdown downloads
    │   └── remote_control.md       the Claude app: Claude Code Remote Control, the Matchday Live connector
    └── references/
        ├── config.md               every key of club.config.yaml
        ├── handoff.md              match reports, the torch pass, the corrections loop
        └── observability.md        the match log and its events (summarising wiki/DATA-CONTRACT.md)
```

The plugin needs the `ogsf` binary on PATH; it does not install it. The skill never runs a set piece's work itself — it launches set pieces and reports on them.

For people rather than Claude, the fleet's docs and step-by-step guide are in `modernized/docs/` (also the **Docs** and **Guide** sections of Matchday Live).

## Install

**For one session, from a local checkout:**

```bash
claude --plugin-dir ./modernized/plugin
```

**From a marketplace.** A marketplace is a repository (or folder) with `.claude-plugin/marketplace.json` at its root. To publish this plugin from the fleet's own repository, add that file at the repository root:

```json
{
  "name": "ogsf",
  "owner": { "name": "Danniel" },
  "description": "One Generalist Software Fleet",
  "plugins": [
    { "name": "ogsf", "source": "./modernized/plugin", "description": "Run and observe the fleet with the ogsf binary" }
  ]
}
```

Then, from a shell:

```bash
claude plugin marketplace add <owner>/<repo>        # or a local path to the repository
claude plugin install ogsf@ogsf
```

or inside Claude Code: `/plugin marketplace add <owner>/<repo>`, then `/plugin install ogsf@ogsf`.

## Check it

```bash
claude plugin validate ./modernized/plugin
```

The manifest follows Claude Code's plugin manifest reference (https://code.claude.com/docs/en/plugins-reference): `.claude-plugin/plugin.json` at the plugin root, skills in `skills/<name>/SKILL.md`, every other file at the plugin root. `homepage` is a placeholder until the fleet's public page exists.
