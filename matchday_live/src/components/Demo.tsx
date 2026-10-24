/**
 * The demo's controls (play, pause, speed, restart) and the guided
 * walkthrough that points at each part of the page in turn.
 */
import { Pause, Play, RotateCcw, Route as RouteIcon, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { INSTANT, SPEEDS, type DemoSource } from '../data/demo'
import { useClock } from '../data/hooks'
import { fmtMatchClock } from '../lib/format'
import { type Route, navigate } from '../lib/router'

export function DemoBar({ demo, onTour }: { demo: DemoSource; onTour: () => void }) {
  const state = useClock(demo.clock)
  if (!state) return null
  const pct = state.totalMs ? (state.virtualMs / state.totalMs) * 100 : 100
  return (
    <div className="demo-bar" role="region" aria-label="Demo controls" data-tour="demo-bar">
      <span className="demo-label">Demo</span>
      {state.finished ? (
        <button type="button" className="icon-button" onClick={() => demo.clock.restart()} aria-label="Play the demo again">
          <Play size={18} />
        </button>
      ) : state.playing ? (
        <button type="button" className="icon-button" onClick={() => demo.clock.pause()} aria-label="Pause the demo">
          <Pause size={18} />
        </button>
      ) : (
        <button type="button" className="icon-button" onClick={() => demo.clock.play()} aria-label="Play the demo">
          <Play size={18} />
        </button>
      )}
      <span className="mono demo-time" aria-label="Replay position">
        {fmtMatchClock(state.virtualMs)} / {fmtMatchClock(state.totalMs)}
      </span>
      <span className="demo-progress" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </span>
      <div className="segmented" role="group" aria-label="Replay speed">
        {SPEEDS.map((speed) => (
          <button
            key={speed}
            type="button"
            aria-pressed={!state.finished && state.speed === speed}
            onClick={() => {
              demo.clock.setSpeed(speed)
              if (!state.playing && !state.finished) demo.clock.play()
            }}
          >
            {speed}×
          </button>
        ))}
        <button type="button" aria-pressed={state.finished} onClick={() => demo.clock.setSpeed(INSTANT)} title="Jump to the end">
          End
        </button>
      </div>
      <button type="button" className="icon-button" onClick={() => demo.clock.restart()} aria-label="Restart the demo">
        <RotateCcw size={16} />
      </button>
      <button type="button" className="button" onClick={onTour}>
        <RouteIcon size={15} aria-hidden="true" /> <span className="tour-text">Walkthrough</span>
      </button>
    </div>
  )
}

interface Step {
  target: string
  title: string
  body: string
  route?: (demo: DemoSource) => Promise<Route>
}

/** The match the walkthrough opens: the one with the most to show so far. */
async function showcase(demo: DemoSource, withObjective = false): Promise<Route> {
  const matches = await demo.matches('all')
  const best =
    matches.find((m) => m.status === 'running' && m.objective_count > 2) ??
    [...matches].sort((a, b) => b.objective_count - a.objective_count)[0]
  if (!best) return { page: 'matches' }
  const objective = withObjective
    ? best.objectives.find((o) => o.kind === 'player' && o.status !== 'running') ?? best.objectives.find((o) => o.kind === 'player')
    : undefined
  return { page: 'match', matchId: best.match_id, objectiveId: objective?.objective_id ?? null }
}

const STEPS: Step[] = [
  {
    target: '[data-tour="matches"]',
    title: 'Every match, as it plays',
    body: 'Each run of a set piece is a match. It appears the moment it kicks off. The coloured bar says how it is going: blue running, green touchdown, red turnover. There is one dot per objective, coloured by the player who owns it, and the cost and time count up live.',
    route: async () => ({ page: 'matches' }),
  },
  {
    target: '[data-tour="filters"]',
    title: 'Find a match',
    body: 'Filter by result, search by id, set piece, ask or machine, and archive a match once you have reviewed it. Archived matches stay one click away.',
    route: async () => ({ page: 'matches' }),
  },
  {
    target: '[data-tour="scoreboard"]',
    title: 'The scoreboard',
    body: 'The match clock runs while the set piece plays. Beside it: the cost, the billed tokens next to what was actually read and written, objectives won and lost, and which founder ran it on which Mac.',
    route: (demo) => showcase(demo),
  },
  {
    target: '[data-tour="timeline"]',
    title: 'Who did what, when',
    body: 'One lane for the head coach (you), one per player, one for the referee (plain code: qa, git, the contract). Each block is an objective; the ticks inside are its tool calls, red when one failed. Pick a block to open it.',
    route: (demo) => showcase(demo),
  },
  {
    target: '[data-tour="feed"]',
    title: 'The live feed',
    body: 'Every event, one line each, the newest at the bottom: kick-offs, tool calls, passes between players, official reviews and the console. Scroll up to read; it waits for you, then follows again when you return to the bottom.',
    route: (demo) => showcase(demo),
  },
  {
    target: '[data-tour="objective"]',
    title: 'Inside an objective',
    body: 'Its events with their arguments and results, the match reports the player handed back (a reply that did not parse shows too), every official review with each item it checked, and the exact team talks the player was given.',
    route: (demo) => showcase(demo, true),
  },
  {
    target: '[data-tour="teamsheet"]',
    title: 'The team sheet',
    body: 'Each player with its club, its model and how full its context window was after its last turn. On pitch, below it, lists the processes still running, so a hung one can be found by its pid.',
    route: (demo) => showcase(demo, true),
  },
  {
    target: '[data-tour="days"] .day-card',
    title: 'Daily reports',
    body: 'Each day the fleet played gets a report: what happened in a paragraph, the key figures, a timeline of the day’s matches (pick a bar to open one), how each player did, the models and set pieces, and what is worth a look. Download a day as PDF or Markdown, or tick several days to build a multi-day report that judges every player across them.',
    route: async () => ({ page: 'days', date: null }),
  },
  {
    target: '[data-tour="upcoming"] .sprint',
    title: 'Upcoming Matches',
    body: 'Planned work, written as markdown tickets in your repository, on a two-week sprint board. An auto ticket starts itself when it is due; Run now queues any ticket, and the form asks for any set piece. A Mac plays a request only when its Scheduler accepts them. In the demo these buttons are switched off.',
    route: async () => ({ page: 'upcoming' }),
  },
  {
    target: '[data-tour="demo-bar"]',
    route: async () => ({ page: 'matches' }),
    title: 'This is a recording',
    body: 'It plays in your browser: pause it, change the speed or jump to the end. To watch your own fleet, open Connections and point the page at a Mac running ogsf var, or at this deployment’s cloud store.',
  },
]

export function Walkthrough({ demo, onClose }: { demo: DemoSource; onClose: () => void }) {
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const card = useRef<HTMLDivElement>(null)
  const step = STEPS[index] as Step

  const locate = useCallback(() => {
    const el = document.querySelector(step.target)
    setRect(el ? el.getBoundingClientRect() : null)
  }, [step.target])

  useEffect(() => {
    let cancelled = false
    let tries = 0
    const go = async () => {
      if (step.route) {
        const route = await step.route(demo)
        if (cancelled) return
        navigate(route)
      }
      const find = () => {
        if (cancelled) return
        const el = document.querySelector(step.target)
        if (el) {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' })
          setTimeout(locate, 350)
        } else if (tries++ < 40) {
          setTimeout(find, 100)
        } else {
          setRect(null)
        }
      }
      find()
    }
    void go()
    return () => {
      cancelled = true
    }
  }, [index, demo, step, locate])

  useEffect(() => {
    window.addEventListener('resize', locate)
    window.addEventListener('scroll', locate, true)
    return () => {
      window.removeEventListener('resize', locate)
      window.removeEventListener('scroll', locate, true)
    }
  }, [locate])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowRight') setIndex((i) => Math.min(STEPS.length - 1, i + 1))
      if (event.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useLayoutEffect(() => {
    card.current?.focus()
  }, [index])

  const pad = 6
  const spot = rect
    ? { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }
    : null
  const cardWidth = Math.min(380, window.innerWidth - 24)
  let top = 24
  let left = (window.innerWidth - cardWidth) / 2
  if (spot) {
    const below = spot.top + spot.height + 12
    top = below + 220 < window.innerHeight ? below : Math.max(12, spot.top - 232)
    left = Math.min(Math.max(12, spot.left), window.innerWidth - cardWidth - 12)
  }

  return (
    <>
      {spot ? <div className="tour-spot" style={spot} aria-hidden="true" /> : null}
      <div
        className="tour"
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        ref={card}
        tabIndex={-1}
        style={{ top, left }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <h2 id="tour-title">{step.title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close the walkthrough">
            <X size={16} />
          </button>
        </div>
        <p>{step.body}</p>
        <div className="tour-foot">
          <span className="tour-step">
            Step {index + 1} of {STEPS.length}
          </span>
          <span style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="button" disabled={index === 0} onClick={() => setIndex(index - 1)}>
              Back
            </button>
            {index < STEPS.length - 1 ? (
              <button type="button" className="button primary" onClick={() => setIndex(index + 1)}>
                Next
              </button>
            ) : (
              <button type="button" className="button primary" onClick={onClose}>
                Done
              </button>
            )}
          </span>
        </div>
      </div>
    </>
  )
}
