/**
 * Reports as Markdown: what the page downloads as a .md file and what the
 * Claude connector answers with. Plain GitHub-flavoured Markdown, tables
 * included, so it reads well in a repository, a pull request or a chat.
 */
import {
  type AgentPerformance,
  type DayReport,
  type MatchLine,
  type ModelUse,
  type Notable,
  type RangeReport,
  type SetPieceUse,
  type Totals,
  compact,
  duration,
  longDate,
  money,
  percent,
} from './report.js'

/** A table cell: pipes escaped, newlines flattened. */
function cell(text: string | number | null | undefined): string {
  return String(text ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ')
}

function table(headers: string[], rows: Array<Array<string | number | null | undefined>>, align?: string[]): string {
  if (rows.length === 0) return '_None._'
  const marks = headers.map((_, i) => (align?.[i] === 'r' ? '---:' : '---'))
  return [
    `| ${headers.map(cell).join(' | ')} |`,
    `| ${marks.join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ].join('\n')
}

function clock(iso: string | null, timeZone: string): string {
  if (!iso) return ''
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
}

function totalsTable(t: Totals): string {
  return table(
    ['Measure', 'Value'],
    [
      ['Matches', `${t.matches} (${t.touchdowns} touchdowns, ${t.turnovers} turnovers${t.running ? `, ${t.running} running` : ''})`],
      ['Stopped by the provider', t.abandoned],
      ['Cost', money(t.cost)],
      ['Billed tokens', compact(t.tokens.billed)],
      ['Read (new input + cache writes)', compact(t.tokens.read)],
      ['Written (output)', compact(t.tokens.written)],
      ['Of which thinking', compact(t.tokens.reasoning)],
      ['Cache reads', compact(t.tokens.cacheRead)],
      ['Time in matches', duration(t.matchSeconds)],
      ['Objectives', `${t.objectives} (${t.objectiveTouchdowns} touchdowns)`],
      ['Extra time', t.extraTime],
      ['Official reviews', `${t.reviewsPassed} passed, ${t.reviewsFailed} failed`],
      ['Replies corrected', t.invalidReplies],
      ['Restricted-area breaches', t.breaches],
      ['QA checks', `${t.qaChecks} run, ${t.qaFailed} failed`],
    ],
  )
}

function matchesTable(lines: MatchLine[], timeZone: string): string {
  return table(
    ['Start', 'Match', 'Set piece', 'Result', 'Time', 'Cost', 'Tokens', 'Models', 'Ask'],
    lines.map((m) => [
      clock(m.started_at, timeZone),
      `\`${m.match_id}\``,
      m.setPiece,
      m.outcome + (m.reason ? `: ${m.reason}` : ''),
      duration(m.seconds),
      money(m.cost),
      compact(m.billedTokens),
      m.models.map((x) => x.replace(/^[a-z]+\//, '')).join(', '),
      m.ask.length > 90 ? `${m.ask.slice(0, 89)}…` : m.ask,
    ]),
    ['l', 'l', 'l', 'l', 'r', 'r', 'r', 'l', 'l'],
  )
}

/** The agent performance table: one row per player. */
export function agentsTable(agents: AgentPerformance[]): string {
  return table(
    ['Player', 'Models', 'Objectives', 'Touchdowns', 'First try', 'Extra time', 'Review fails', 'Corrected replies', 'Breaches', 'Cost', 'Cost / objective', 'Avg time', 'Cache share', 'Peak context'],
    agents.map((a) => [
      a.player,
      a.models.map((x) => x.replace(/^[a-z]+\//, '')).join(', '),
      a.objectives,
      `${a.touchdowns} (${percent(a.successRate)})`,
      percent(a.firstTryRate),
      a.extraTime,
      a.reviewFailures,
      a.invalidReplies,
      a.breaches,
      money(a.cost),
      money(a.costPerObjective),
      duration(a.avgSeconds),
      percent(a.cacheShare),
      a.peakContext === null ? '' : percent(a.peakContext),
    ]),
    ['l', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'],
  )
}

function modelsTable(models: ModelUse[]): string {
  return table(
    ['Model', 'Club', 'Players', 'Objectives', 'Cost', 'Billed tokens'],
    models.map((m) => [m.model, m.club, m.players.join(', '), m.objectives, money(m.cost), compact(m.billedTokens)]),
    ['l', 'l', 'l', 'r', 'r', 'r'],
  )
}

function piecesTable(pieces: SetPieceUse[]): string {
  return table(
    ['Set piece', 'Matches', 'Touchdowns', 'Turnovers', 'Cost', 'Avg cost', 'Avg time'],
    pieces.map((p) => [p.setPiece, p.matches, p.touchdowns, p.turnovers, money(p.cost), money(p.avgCost), duration(p.avgSeconds)]),
    ['l', 'r', 'r', 'r', 'r', 'r', 'r'],
  )
}

function notableList(notable: Notable[]): string {
  if (notable.length === 0) return '_Nothing to look at._'
  return notable.map((n) => `- **${n.kind.replace('_', ' ')}** \`${n.match_id}\`: ${n.text}`).join('\n')
}

/** One day's report. */
export function dayMarkdown(day: DayReport, timeZone: string, heading = '#'): string {
  return [
    `${heading} ${longDate(day.date)}`,
    '',
    day.summary,
    '',
    `From ${clock(day.first, timeZone)} to ${clock(day.last, timeZone)} (${timeZone}).`,
    '',
    `${heading}# Totals`,
    '',
    totalsTable(day.totals),
    '',
    `${heading}# Matches`,
    '',
    matchesTable(day.matches, timeZone),
    '',
    `${heading}# Agent performance`,
    '',
    agentsTable(day.agents),
    '',
    `${heading}# Models used`,
    '',
    modelsTable(day.models),
    '',
    `${heading}# Set pieces`,
    '',
    piecesTable(day.setPieces),
    '',
    `${heading}# Worth a look`,
    '',
    notableList(day.notable),
    '',
  ].join('\n')
}

/** The daily report as its own document. */
export function dailyReportMarkdown(day: DayReport, timeZone: string): string {
  return `${dayMarkdown(day, timeZone, '#')}\n_Matchday Live daily report. Days are cut in ${timeZone}._\n`
}

/**
 * The multi-day report: the period, agent performance across it (the table
 * to judge every player by), models, set pieces, what to look at, then every
 * day in full.
 */
export function rangeReportMarkdown(report: RangeReport): string {
  const title =
    report.from && report.to
      ? report.from === report.to
        ? longDate(report.from)
        : `${longDate(report.from)} to ${longDate(report.to)}`
      : 'No matches'
  const dayRows = report.days.map((d) => [
    longDate(d.date),
    d.totals.matches,
    d.totals.touchdowns,
    d.totals.turnovers,
    money(d.totals.cost),
    compact(d.totals.tokens.billed),
    duration(d.totals.matchSeconds),
  ])
  return [
    `# Multi-day report: ${title}`,
    '',
    report.summary,
    '',
    `Generated ${report.generatedAt.slice(0, 16).replace('T', ' ')} UTC. Days are cut in ${report.timeZone}.`,
    '',
    '## Totals',
    '',
    totalsTable(report.totals),
    '',
    '## Agent performance',
    '',
    'Every player across the period: how often it scored, how often it scored on the first try (no corrected reply, every official review green at once), how much extra time and correction it needed, and what it cost.',
    '',
    agentsTable(report.agents),
    '',
    '## Models used',
    '',
    modelsTable(report.models),
    '',
    '## Set pieces',
    '',
    piecesTable(report.setPieces),
    '',
    '## Day by day',
    '',
    table(['Day', 'Matches', 'Touchdowns', 'Turnovers', 'Cost', 'Billed tokens', 'Time'], dayRows, ['l', 'r', 'r', 'r', 'r', 'r', 'r']),
    '',
    '## Worth a look',
    '',
    notableList(report.notable),
    '',
    ...report.days.flatMap((d) => [dayMarkdown(d, report.timeZone, '##'), '']),
    `_Matchday Live multi-day report._`,
    '',
  ].join('\n')
}
