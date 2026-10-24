/**
 * Which source the page reads from, chosen once at start and changeable on
 * the Connections page.
 *
 * With nothing chosen yet, the page asks its own server first: `ogsf var`
 * answers as a Mac's fleet, a configured Vercel deployment as the cloud
 * store. When neither answers (the page opened from `vite`, or a deployment
 * without a database), it plays the demo, so there is always something real
 * to look at.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { HealthResponse } from '../../shared/types'
import { DemoSource, loadDemoDataset } from './demo'
import { HttpSource } from './http'
import { type Source, type SourceChoice, fleetApiBase, loadChoice, saveChoice } from './source'

export interface SourceState {
  source: Source | null
  choice: SourceChoice | null
  health: HealthResponse | null
  demo: DemoSource | null
  error: string | null
  /** Pick a source and remember it in this browser. */
  choose: (choice: SourceChoice) => void
}

const Context = createContext<SourceState | null>(null)

export function useSource(): SourceState {
  const state = useContext(Context)
  if (!state) throw new Error('useSource outside SourceProvider')
  return state
}

async function probeHere(): Promise<HealthResponse | null> {
  try {
    const response = await fetch('/api/health', { credentials: 'same-origin', headers: { accept: 'application/json' } })
    if (!response.ok) return null
    const body = (await response.json()) as HealthResponse
    return typeof body.source === 'string' ? body : null
  } catch {
    return null
  }
}

function labelFor(choice: SourceChoice, health: HealthResponse | null): string {
  if (choice.kind === 'demo') return 'Demo recording'
  if (choice.kind === 'fleet') return `Fleet at ${new URL(choice.url).host}`
  return health?.source === 'cloud' ? 'Cloud store' : 'This Mac'
}

export function SourceProvider({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState<SourceChoice | null>(() => loadChoice())
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [source, setSource] = useState<Source | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Nothing chosen: ask this page's own server what it is.
  useEffect(() => {
    if (choice) return
    let cancelled = false
    void probeHere().then((answer) => {
      if (cancelled) return
      const usable = answer && (answer.source === 'local' ? answer.ok : answer.configured !== false)
      setChoice(usable ? { kind: 'here' } : { kind: 'demo' })
    })
    return () => {
      cancelled = true
    }
  }, [choice])

  useEffect(() => {
    if (!choice) return
    let cancelled = false
    let made: Source | null = null
    setError(null)
    setSource(null)
    const start = async () => {
      try {
        if (choice.kind === 'demo') {
          const dataset = await loadDemoDataset()
          if (cancelled) return
          const demo = new DemoSource(dataset)
          made = demo
          setHealth(await demo.health())
          setSource(demo)
          demo.clock.play()
          return
        }
        const base = choice.kind === 'here' ? '/api' : fleetApiBase(choice.url)
        if (!base) throw new Error('That fleet address is not an http(s) URL.')
        const probe = new HttpSource(base, choice.kind, '')
        let answer: HealthResponse | null = null
        try {
          answer = await probe.health()
        } catch {
          answer = null
        }
        if (cancelled) return
        setHealth(answer)
        const http = new HttpSource(base, choice.kind, labelFor(choice, answer))
        made = http
        setSource(http)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    }
    void start()
    return () => {
      cancelled = true
      made?.close()
    }
  }, [choice])

  const choose = useCallback((next: SourceChoice) => {
    saveChoice(next)
    setChoice(next)
  }, [])

  const value = useMemo<SourceState>(
    () => ({
      source,
      choice,
      health,
      demo: source instanceof DemoSource ? source : null,
      error,
      choose,
    }),
    [source, choice, health, error, choose],
  )
  return <Context.Provider value={value}>{children}</Context.Provider>
}
