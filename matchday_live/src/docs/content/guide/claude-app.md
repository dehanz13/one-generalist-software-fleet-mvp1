# Connect the Claude app

Two ways, side by side on [Remote control](../remote.md). Set up either or
both.

## A · Claude Code Remote Control

This drives a whole Claude Code session running on your Mac, from the
Claude app or claude.ai/code. Checked against Claude Code's documentation
(code.claude.com/docs/en/remote-control) on 2026-10-17.

**Before you start:** a Pro, Max, Team or Enterprise plan, and Claude Code
signed in through claude.ai (run `claude`, then `/login`). API keys do not
work for Remote Control. On Team and Enterprise, an Owner must first turn
on Remote Control in the Claude Code admin settings.

1. Start Claude Code in your repository with the OGSF plugin loaded and
   Remote Control on:

   ```sh
   cd ~/code/my-project
   claude --plugin-dir /path/to/ogsf-fleet/modernized/plugin --remote-control "OGSF"
   ```

   Or, in a session that is already running, type `/remote-control` (or
   `/rc`). For a server that waits for the app, run
   `claude remote-control --name "OGSF"`; server mode does not carry flags
   such as `--plugin-dir` over to its sessions, so install the plugin from
   a marketplace first (see `plugin/README.md`).
2. The first time, Claude Code asks you to confirm **Enable Remote
   Control**, and to trust the folder if you have not yet.
3. Open the session on your phone: scan the QR code it shows, open the
   session URL, or open the Claude app, tap **Code**, and pick the session
   by name. Online sessions show a computer icon with a green dot.
4. Talk to it as you would at the Mac: "run the timer request on
   run-heroic", "what did the last match do?", "start the scheduler for an
   hour".

Keep the Mac awake and the `claude` process running. If the network drops
or the laptop sleeps, it reconnects by itself when the Mac is back. To stop
sharing, run `/remote-control` again and disconnect.

## B · The Matchday Live connector

This needs your [Matchday Live deployment](matchday-live-cloud.md). It does
not need Claude Code, or any Mac to be on a session.

1. In the Claude app, open **Customize → Connectors**, choose **+ Add**,
   then **Add custom connector**. (On Team and Enterprise, an Owner adds it
   under **Organization settings → Connectors**, and members connect to it
   from **Customize → Connectors**.)
2. Name it "Matchday Live" and enter the URL
   `https://<your app>.vercel.app/api/mcp`.
3. Continue through the authentication step: the connector uses OAuth, so
   choose to sign in. A Matchday Live page opens; enter your
   `MATCHDAY_PASSWORD` and allow access.
4. In a chat, turn the connector on from the **+** menu → **Connectors**,
   and ask: "what is the fleet doing?", "give me this week's report", "which
   tickets are due tomorrow?", "queue a scout-opposition: where is auth
   handled?".

For a queued request to run, the Mac that should take it needs, in its
`club.config.yaml`:

```yaml
scheduler:
  accept_remote: true
  allowed_set_pieces: [ask, scout-opposition, team-talk]
```

and `ogsf scheduler` running with its relay set up. A request for a set
piece that is not listed is refused, with the reason; a request for one of
your tickets runs whatever the ticket says. Every match passes its kickoff
checklist. `request_status` in the app, or `ogsf requests` on the Mac,
shows where a request is.

To disconnect, remove the connector in the app. To cut off every connected
app at once, change `MATCHDAY_PASSWORD` in Vercel and redeploy.

The sign-in sends the browser back only to claude.ai, claude.com or
localhost. If a client on another host needs it, set
`MATCHDAY_CONNECTOR_REDIRECTS` in Vercel to its host name (comma-separated
for several) and redeploy.

## C · The same connector from Claude Code

Claude Code can use the connector too, in any repository, with no fleet on
that machine:

```sh
claude mcp add --transport http matchday https://<your app>.vercel.app/api/mcp
```

Then, inside Claude Code, run `/mcp` and sign in with your
`MATCHDAY_PASSWORD`. Ask it for the week's report or what is due tomorrow
as you would in the app.
