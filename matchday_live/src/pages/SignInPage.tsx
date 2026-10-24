import { useEffect, useState, type FormEvent } from 'react'
import { Notice } from '../components/common'
import { cloud } from '../data/cloud'
import { useSource } from '../data/context'
import { hrefFor, navigate } from '../lib/router'

/** Sign in to the cloud store. The password is checked on the server; the cookie is HttpOnly. */
export function SignInPage() {
  const { choose, choice } = useSource()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [signedIn, setSignedIn] = useState<boolean | null>(null)

  useEffect(() => {
    cloud
      .signedIn()
      .then((r) => setSignedIn(r.signed_in))
      .catch(() => setSignedIn(false))
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await cloud.signIn(password)
      setPassword('')
      if (choice?.kind !== 'here') choose({ kind: 'here' })
      navigate({ page: 'matches' })
      // A fresh start, so every view re-reads with the new cookie.
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const signOut = async () => {
    await cloud.signOut().catch(() => undefined)
    setSignedIn(false)
  }

  return (
    <div className="signin panel">
      <div className="panel-body">
        <h1>Sign in</h1>
        <p className="dim">The cloud store holds your matches, prompts and code. Only someone with the password set in Vercel can read it.</p>
        {signedIn ? (
          <>
            <Notice>
              <p>You are signed in on this browser.</p>
            </Notice>
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <a className="button primary" href={hrefFor({ page: 'matches' })}>
                See the matches
              </a>
              <button type="button" className="button" onClick={() => void signOut()}>
                Sign out
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error ? (
              <Notice tone="bad">
                <p>{error}</p>
              </Notice>
            ) : null}
            <button type="submit" className="button primary" disabled={busy || !password}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <p className="muted" style={{ margin: 0 }}>
              No password yet? You can <a href={hrefFor({ page: 'connections' })}>watch the demo</a> without one.
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
