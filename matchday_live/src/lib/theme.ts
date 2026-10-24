/** Light, dark, or the system's choice; remembered per browser. */
import { useCallback, useEffect, useState } from 'react'

export type ThemeChoice = 'system' | 'light' | 'dark'

const KEY = 'matchday.theme'

function read(): ThemeChoice {
  try {
    const value = localStorage.getItem(KEY)
    if (value === 'light' || value === 'dark') return value
  } catch {
    // Storage blocked: follow the system.
  }
  return 'system'
}

function apply(choice: ThemeChoice) {
  const root = document.documentElement
  if (choice === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', choice)
}

export function useTheme(): [ThemeChoice, () => void] {
  const [choice, setChoice] = useState<ThemeChoice>(read)
  useEffect(() => apply(choice), [choice])
  const cycle = useCallback(() => {
    setChoice((current) => {
      const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      // One click always changes what you see: from the system's look to the other one.
      const next: ThemeChoice =
        current === 'system' ? (systemDark ? 'light' : 'dark') : current === 'dark' ? 'light' : 'dark'
      try {
        localStorage.setItem(KEY, next)
      } catch {
        // Not remembered, but applied.
      }
      return next
    })
  }, [])
  return [choice, cycle]
}
