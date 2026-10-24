# Reports and downloads

Daily reports, multi-day reports with each player's performance, and their PDF and Markdown downloads. Load this when the founder asks how the fleet did, what it cost, which player or model to change, or for a report to share.

The founder's docs page is `docs/measures.md`: it explains every measure. Read it before you interpret one.

## Where reports come from

Every report is computed by `matchday_live/shared/report.ts` from the rows `GET /api/report-facts?since=&until=` returns — on the page, in the Claude connector, the same code. **Never compute your own totals in SQL and present them as "the report"**: they will disagree with the page (cache tokens, abandoned matches and corrected replies are easy to get wrong).

| Want | Where |
|---|---|
| one day, every day with matches | Matchday Live → **Daily reports**, `#/days`, or `#/days/<YYYY-MM-DD>` |
| a period, with player performance | `#/report?from=<YYYY-MM-DD>&to=<YYYY-MM-DD>` |
| a file to share | **Download PDF** or **Download Markdown** on either report |
| the same in the Claude app | the connector's `daily_report` and `multi_day_report` (Markdown) |

Locally, start the page and give the founder the address — don't screenshot it for them unless asked:

```bash
ogsf var --no-open        # then: http://127.0.0.1:4600/#/report?from=2026-10-12&to=2026-10-17
```

Days are cut in the viewer's time zone on the page; the connector uses the zone a request names, else `MATCHDAY_TIMEZONE`, else UTC. Say which zone a report used when days matter.

## Reading one (what to say)

Lead with outcomes, then cost, then what to change:

- **Touchdowns / turnovers / abandoned.** Abandoned (exit 75) is a provider stop: exclude it from any judgement of a player.
- **Per player: touchdown rate and first-try rate.** First-try (no corrected reply, every review green on attempt 1) is the honest one. A big gap between the two means the player gets there, expensively.
- **Corrected replies** high for one player → its `user.md` match-report section or its model struggles with the format (`update_team_talks.md`).
- **Extra time** (`iterate_*`, `revise_*`) high → the builder's first build is weak, or the qa checks are noisy.
- **Tokens: read, written, billed.** Billed re-counts cached context every turn, so it dwarfs read + written; **cache share** says how much was served cheaply. Do not call a high billed count waste without looking at cache share.
- **Peak context** near 100% → the player is one long task from losing its early context.
- **Cost per objective** high with a low first-try rate is the first place to save. Suggest a model change only as a proposal; changing `model:` is the founder's call (`update_config.md`).

## When the founder wants numbers in the terminal

For one match, use `ogsf passages`/`highlights-match` (`observe.md`). For quick counts across matches, `sqlite3` read-only against `set_pieces/clubhouse/match_log.db` is fine — label it "a quick count from the match log", not a report, and point to the page for the real one.

## Report

Give the period and zone, the headline outcome, the two or three players or models worth attention with the measure that says so, and the link (or downloaded file) to the full report.
