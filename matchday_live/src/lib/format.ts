/** Formatting for numbers, money, durations and times. Pure and tested. */

export function ts(iso: string | null | undefined): number {
  if (!iso) return Number.NaN
  return new Date(iso).getTime()
}

/** 0.42s · 9.8s · 3m 07s · 1h 04m */
export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${(ms / 1000).toFixed(2)}s`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const rem = Math.floor(s % 60)
  if (m < 60) return `${m}m ${String(rem).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  return `${h}h ${String(m % 60).padStart(2, '0')}m`
}

/** The scoreboard clock: 07:42, or 1:07:42 past an hour. */
export function fmtMatchClock(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '--:--'
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function fmtClock(iso: string | null | undefined): string {
  const t = ts(iso)
  if (!Number.isFinite(t)) return '—'
  return new Date(t).toLocaleTimeString([], { hour12: false })
}

export function fmtDate(iso: string | null | undefined): string {
  const t = ts(iso)
  if (!Number.isFinite(t)) return '—'
  const d = new Date(t)
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${fmtClock(iso)}`
}

/** How long ago, in words: "just now", "4 min ago", "3 h ago", "2 days ago". */
export function fmtAgo(iso: string | null | undefined, now: number): string {
  const t = ts(iso)
  if (!Number.isFinite(t)) return '—'
  const s = Math.max(0, (now - t) / 1000)
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 36) return `${h} h ago`
  const d = Math.round(h / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}

/** 812 · 41.3k · 1.45M */
export function fmtTokens(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

/** $0.0431 under a dollar, $4.39 above. */
export function fmtCost(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`
}

/** Per-component money runs to fractions of a cent: four places keep it real. */
export function fmtMoney(n: number): string {
  if (!n) return '$0'
  return n < 0.0001 ? '<$0.0001' : `$${n.toFixed(4)}`
}

const NUMBER = new Intl.NumberFormat('en-US')

export function fmtInt(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? '—' : NUMBER.format(n)
}

/** A share as a percentage that never rounds a real non-zero value to 0%. */
export function fmtPercent(part: number, whole: number): string {
  if (!whole) return '—'
  const pct = (part / whole) * 100
  return pct > 0 && pct < 1 ? `${pct.toFixed(1)}%` : `${Math.round(pct)}%`
}

/** Compact offset label for time axes: 0s, 30s, 1m, 1m30s, 1h05m. */
export function fmtOffset(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) {
    const rem = s % 60
    return rem ? `${m}m${String(rem).padStart(2, '0')}s` : `${m}m`
  }
  const h = Math.floor(m / 60)
  const mrem = m % 60
  return mrem ? `${h}h${String(mrem).padStart(2, '0')}m` : `${h}h`
}

const TICK_STEPS_MS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1200, 1800, 3600, 7200].map((s) => s * 1000)

/** Evenly stepped time-axis ticks over a span, at most `maxTicks` of them. */
export function axisTicks(spanMs: number, maxTicks = 8): Array<{ pct: number; label: string }> {
  const span = Math.max(spanMs, 1)
  const step = TICK_STEPS_MS.find((s) => span / s <= maxTicks) ?? 7_200_000
  const out: Array<{ pct: number; label: string }> = []
  for (let t = 0; t <= span; t += step) out.push({ pct: (t / span) * 100, label: fmtOffset(t) })
  return out
}

/** "anthropic/claude-sonnet-5-5" → "claude-sonnet-5-5" (the full id stays in titles). */
export function modelName(model: string | null | undefined): string {
  if (!model) return ''
  return model.split('/').filter(Boolean).at(-1) ?? model
}

export function modelProvider(model: string | null | undefined): string {
  if (!model || !model.includes('/')) return ''
  return model.split('/')[0] ?? ''
}

/** "#c89bff" plus alpha → rgba(), or transparent for anything that is not a hex colour. */
export function hexAlpha(hex: string | null | undefined, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? '').trim())
  if (!m?.[1]) return 'transparent'
  const n = Number.parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff}, ${alpha})`
}

/** How long a match or objective has run: to its end, or to `now` while running. */
export function durationOf(
  row: { started_at: string | null; ended_at: string | null; status: string | null },
  now: number,
): number {
  const start = ts(row.started_at)
  if (!Number.isFinite(start)) return Number.NaN
  const end = row.status === 'running' ? now : ts(row.ended_at)
  return (Number.isFinite(end) ? end : now) - start
}
