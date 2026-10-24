# Remote control from the Claude app

Two ways the founder can drive the fleet away from the Mac. Load this when the founder asks to run or check the fleet from a phone, claude.ai, the Claude app, "remote control", or the Matchday Live connector.

The founder's pages are `docs/remote.md` and `docs/guide/claude-app.md`.

| Path | What it is | Can |
|---|---|---|
| **Claude Code Remote Control** | the Claude app or claude.ai/code attached to a Claude Code session **running on the Mac** | anything the founder could type at the Mac, including you running `ogsf` |
| **Matchday Live connector** | a remote MCP server at `https://<app>/api/mcp`, added to the Claude app | read status, matches, reports, Upcoming; queue requests a Mac may take |

## 1 · Claude Code Remote Control

Checked against code.claude.com/docs/en/remote-control on 2026-10-17. Re-check that page before giving the founder exact steps if much time has passed — it changes.

Requirements: a Pro, Max, Team or Enterprise plan; Claude Code signed in through claude.ai (`/login`) — API keys do not work; on Team/Enterprise an Owner enables Remote Control in the admin settings. Not available with Bedrock, Google Cloud's Agent Platform, Microsoft Foundry, or `ANTHROPIC_BASE_URL` pointing elsewhere.

Start it in the repository:

```bash
claude --plugin-dir /path/to/modernized/plugin --remote-control "OGSF"   # interactive, also remote
claude remote-control --name "OGSF"                                     # server mode; install the plugin from a marketplace first — server mode does not carry --plugin-dir
```

or, in this session, the founder types `/remote-control` (`/rc`). The founder connects by the session URL, the QR code, or the Claude app's **Code** tab. The Mac must stay awake and `claude` running.

When you are the session being driven remotely, nothing changes about your rules: the founder's messages arrive the same way, and you still route each request through its cookbook. Keep replies short — the founder is on a phone.

## 2 · The Matchday Live connector

Needs a Matchday Live deployment (`observe.md` → the relay and Vercel). The founder adds it in the Claude app: **Customize → Connectors → + Add → Add custom connector**, URL `https://<app>/api/mcp`, sign in (OAuth; the page asks for `MATCHDAY_PASSWORD`). On Team/Enterprise an Owner adds it under **Organization settings → Connectors**.

Its tools: `fleet_status`, `list_matches`, `get_match`, `daily_report`, `multi_day_report`, `list_upcoming`, `queue_request`, `queue_ticket`, `request_status`, `cancel_request`. OAuth 2.1 with PKCE (clients by Client ID Metadata Document URL, Claude's default, or dynamic registration); the consent page asks for `MATCHDAY_PASSWORD`; redirects go only to claude.ai, claude.com or localhost unless `MATCHDAY_CONNECTOR_REDIRECTS` (comma-separated hosts) names more.

From Claude Code, in any repository: `claude mcp add --transport http matchday https://<app>/api/mcp`, then `/mcp` to sign in. That is how **you** can read the founder's reports and queue requests from a session that has no fleet on its own Mac.

For a queued request to run, a Mac needs `scheduler.accept_remote: true`, the set piece in `scheduler.allowed_set_pieces` (for a request by set piece name), `ogsf scheduler` running and its relay set up (`upcoming_matches.md`). Turning `accept_remote` on is the founder's decision — explain what it allows (the allowlist, tickets they wrote, the kickoff checklist still applies) and let them choose.

## Which to suggest

- Steer real work, read code, fix a failed match → Remote Control.
- Check on the fleet, read a report, queue a known kind of job → the connector.
- Hand over a week of work → neither: tickets plus `ogsf scheduler` (`upcoming_matches.md`).

## Troubleshooting

- "Remote Control requires a claude.ai subscription" → `claude auth login` with the claude.ai option; remove `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` from the environment if the message names them. `claude doctor` names the failing eligibility check.
- A queued request never starts → `ogsf requests` on the Mac and `request_status` in the app; then the four conditions above.
- To cut off every connected app at once: change `MATCHDAY_PASSWORD` in Vercel and redeploy.
