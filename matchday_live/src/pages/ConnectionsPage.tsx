/**
 * Every connection, set from the page: where the page reads from, the cloud
 * store's set-up, and the Macs allowed to relay into it. Secrets stay in
 * Vercel's environment variables; this page only ever sees their names.
 */
import { CheckCircle2, Copy, KeyRound, RefreshCw, XCircle } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { ConnectionsStatus, ConnectorGrant, ConnectorStatus, FleetToken, HealthResponse, MintedToken } from '../../shared/types'
import { Notice } from '../components/common'
import { cloud } from '../data/cloud'
import { useSource } from '../data/context'
import { HttpSource } from '../data/http'
import { ApiFailure, type SourceChoice, fleetApiBase } from '../data/source'
import { fmtAgo, fmtDate } from '../lib/format'
import { hrefFor } from '../lib/router'

async function probeHere(): Promise<HealthResponse | null> {
  try {
    return await new HttpSource('/api', 'here', '').health()
  } catch {
    return null
  }
}

export function ConnectionsPage() {
  const { choice, choose, demo } = useSource()
  const [here, setHere] = useState<HealthResponse | null | undefined>(undefined)
  const [kind, setKind] = useState<SourceChoice['kind']>(choice?.kind ?? 'demo')
  const [url, setUrl] = useState(choice?.kind === 'fleet' ? choice.url : 'http://127.0.0.1:4600')
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    void probeHere().then(setHere)
  }, [])

  useEffect(() => {
    if (choice) setKind(choice.kind)
  }, [choice])

  const testFleet = async () => {
    const base = fleetApiBase(url)
    if (!base) {
      setTest({ ok: false, text: 'Enter an address that starts with http:// or https://.' })
      return
    }
    setTest(null)
    try {
      const health = await new HttpSource(base, 'fleet', '').health()
      setTest({
        ok: health.ok,
        text: health.ok
          ? `Connected: ${health.matches} match${health.matches === 1 ? '' : 'es'} in ${health.store}.`
          : `It answered, but its store is not ready: ${health.store}.`,
      })
    } catch (error) {
      setTest({
        ok: false,
        text:
          error instanceof Error
            ? `${error.message} If it is running, the browser may be blocking a public page from reaching your network: allow it when the browser asks.`
            : 'Could not connect.',
      })
    }
  }

  const save = (event: FormEvent) => {
    event.preventDefault()
    const next: SourceChoice = kind === 'fleet' ? { kind: 'fleet', url: url.trim() } : { kind }
    if (next.kind === 'fleet' && !fleetApiBase(next.url)) {
      setTest({ ok: false, text: 'Enter an address that starts with http:// or https://.' })
      return
    }
    choose(next)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const hereText =
    here === undefined
      ? 'Checking what this page is served from…'
      : here === null
        ? 'This page is not served by a fleet or a cloud deployment right now, so there is nothing here to read.'
        : here.source === 'local'
          ? `This Mac's match log, served by ogsf var (${here.matches} matches in ${here.store}).`
          : here.configured === false
            ? 'The cloud store of this Vercel deployment. It has no database yet: set DATABASE_URL below.'
            : `The cloud store of this Vercel deployment (Supabase). Every Mac that relays shows up here.`

  return (
    <div className="settings">
      <div className="page-head">
        <div>
          <h1>Connections</h1>
          <p>Choose what this page shows, and connect your Macs to the cloud store.</p>
        </div>
      </div>

      <section className="panel" aria-labelledby="source-title">
        <div className="panel-head">
          <h2 id="source-title">What this page reads</h2>
        </div>
        <form className="panel-body" onSubmit={save}>
          <div className="choice-list" role="radiogroup" aria-label="Source">
            <label className="choice">
              <input type="radio" name="source" checked={kind === 'demo'} onChange={() => setKind('demo')} />
              <span>
                <span className="title">Demo recording</span>
                <p>A recording of real matches, replayed in your browser as if live. Needs no fleet and no database.</p>
              </span>
            </label>
            <label className="choice">
              <input type="radio" name="source" checked={kind === 'here'} onChange={() => setKind('here')} disabled={here === null} />
              <span>
                <span className="title">This deployment</span>
                <p>{hereText}</p>
              </span>
            </label>
            <label className="choice">
              <input type="radio" name="source" checked={kind === 'fleet'} onChange={() => setKind('fleet')} />
              <span style={{ minWidth: 0 }}>
                <span className="title">A fleet at an address</span>
                <p>
                  A Mac running <code>ogsf var</code>, read directly. On the same Mac that is <code>http://127.0.0.1:4600</code>.
                </p>
                {kind === 'fleet' ? (
                  <span className="row">
                    <label className="visually-hidden" htmlFor="fleet-url">
                      Fleet address
                    </label>
                    <input
                      id="fleet-url"
                      className="input mono"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="http://127.0.0.1:4600"
                      inputMode="url"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button type="button" className="button" onClick={() => void testFleet()}>
                      Test the connection
                    </button>
                  </span>
                ) : null}
                {kind === 'fleet' && test ? (
                  <p className={test.ok ? 'tone-good' : 'tone-bad'} role="status">
                    {test.text}
                  </p>
                ) : null}
              </span>
            </label>
          </div>
          <div className="row" style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14 }}>
            <button type="submit" className="button primary">
              Use this source
            </button>
            {saved ? <span className="tone-good">Saved in this browser.</span> : null}
          </div>
        </form>
      </section>

      {here?.source === 'cloud' ? <CloudStore /> : null}

      {demo && here?.source !== 'cloud' ? (
        <section className="panel" aria-labelledby="connector-title">
          <div className="panel-head">
            <h2 id="connector-title">Claude connector</h2>
            <span className="muted">an example from the demo</span>
          </div>
          <div className="panel-body">
            <ClaudeConnector connector={demo.connector().status} demoGrants={demo.connector().grants} heading={false} />
          </div>
        </section>
      ) : null}

      <section className="panel" aria-labelledby="mac-title">
        <div className="panel-head">
          <h2 id="mac-title">Connect a Mac</h2>
        </div>
        <div className="panel-body">
          <p className="dim" style={{ marginTop: 0 }}>
            Each Mac keeps its own match log and sends every new row to the cloud store as it is written. It needs two
            values in the <code>.env</code> file at the root of the repository it works in (never committed), or in its
            environment:
          </p>
          <pre className="code">{`CLUB_RELAY_URL=${here?.source === 'cloud' ? window.location.origin : 'https://<your app>.vercel.app'}
CLUB_RELAY_TOKEN=<a fleet token minted for this Mac>`}</pre>
          <p className="dim">
            Then <code>ogsf relay status</code> shows whether it is connected, and <code>ogsf relay push</code> sends
            anything a Mac could not send while it was offline. To watch one Mac without the cloud, run{' '}
            <code>ogsf var</code> on it: it opens this same page on <code>http://127.0.0.1:4600</code>, reading the
            Mac's own file.
          </p>
        </div>
      </section>
    </div>
  )
}

function CloudStore() {
  const [status, setStatus] = useState<ConnectionsStatus | null>(null)
  const [error, setError] = useState<ApiFailure | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setError(null)
    cloud
      .status()
      .then(setStatus)
      .catch((err: unknown) => setError(err instanceof ApiFailure ? err : new ApiFailure(0, String(err))))
  }, [])

  useEffect(load, [load])

  if (error?.status === 401) {
    return (
      <section className="panel">
        <div className="panel-head">
          <h2>Cloud store</h2>
        </div>
        <div className="panel-body">
          <Notice tone="warn">
            <p>
              <a href={hrefFor({ page: 'sign-in' })}>Sign in</a> to see the cloud store's set-up and manage fleet tokens.
            </p>
          </Notice>
        </div>
      </section>
    )
  }

  const apply = async () => {
    setBusy(true)
    try {
      await cloud.applySchema()
      load()
    } catch (err) {
      setError(err instanceof ApiFailure ? err : new ApiFailure(0, String(err)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel" aria-labelledby="cloud-title">
      <div className="panel-head">
        <h2 id="cloud-title">Cloud store</h2>
        <button type="button" className="icon-button" onClick={load} aria-label="Check again">
          <RefreshCw size={16} />
        </button>
      </div>
      <div className="panel-body">
        {error ? (
          <Notice tone="bad">
            <p>{error.message}</p>
          </Notice>
        ) : null}
        {!status ? (
          <p className="muted">Checking the set-up…</p>
        ) : (
          <>
            <h3 className="section-title">Environment variables in Vercel</h3>
            <ul className="env-list">
              {status.env.map((env) => (
                <li key={env.name}>
                  {env.set ? (
                    <CheckCircle2 size={18} className="tone-good" aria-label="set" />
                  ) : (
                    <XCircle size={18} className="tone-bad" aria-label="missing" />
                  )}
                  <span>
                    <code>{env.name}</code> <span className="dim">{env.purpose}</span>
                    {env.set ? null : <span className="tone-bad"> Missing.</span>}
                  </span>
                </li>
              ))}
            </ul>
            <p className="muted">
              Set them in Vercel under Settings, Environment Variables, then redeploy. Their values never reach this page.
            </p>

            <h3 className="section-title">Database</h3>
            {status.database.reachable ? (
              <p className="tone-good">Supabase answers.</p>
            ) : (
              <p className="tone-bad">Not reachable: {status.database.error}</p>
            )}
            {status.database.reachable ? (
              status.schema.applied ? (
                <p className="dim">The match log schema is applied (version {status.schema.version}).</p>
              ) : (
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="dim">
                    The match log tables are not there yet
                    {status.schema.version !== null ? ` (found version ${status.schema.version})` : ''}.
                  </span>
                  <button type="button" className="button primary" disabled={busy} onClick={() => void apply()}>
                    {busy ? 'Applying…' : 'Apply the schema'}
                  </button>
                </div>
              )
            ) : null}
          </>
        )}
        {status?.database.reachable && status.schema.applied ? <FleetTokens /> : null}
        {status?.connector ? <ClaudeConnector connector={status.connector} /> : null}
      </div>
    </section>
  )
}

const CONNECTED_FROM: Record<string, string> = { 'claude.ai': 'the Claude app', localhost: 'Claude Code', '127.0.0.1': 'Claude Code' }

/**
 * The Claude connector: the address to paste into Claude, whether it is
 * ready, and every live connection with a way to end it. In the demo it shows
 * an example and changes nothing.
 */
function ClaudeConnector({
  connector,
  demoGrants,
  heading = true,
}: {
  connector: ConnectorStatus
  /** The demo's example connections: shown, never changed. */
  demoGrants?: ConnectorGrant[]
  /** False inside a panel that already says "Claude connector". */
  heading?: boolean
}) {
  const demo = demoGrants !== undefined
  const [grants, setGrants] = useState<ConnectorGrant[] | null>(demoGrants ?? null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(() => {
    if (demo) return
    cloud
      .grants()
      .then((rows) => {
        setGrants(rows)
        setError(null)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [demo])
  useEffect(load, [load])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(connector.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  const revoke = async (grant: ConnectorGrant) => {
    if (!window.confirm(`End the connection from ${grant.client_name ?? grant.client_id}? It has to sign in again to come back.`)) return
    try {
      await cloud.revokeGrant(grant.grant_id)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const revokeAll = async () => {
    if (!window.confirm('End every connector connection? Each client has to sign in again.')) return
    try {
      await cloud.revokeAllGrants()
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const command = `claude mcp add --transport http matchday ${connector.url}`
  return (
    <div className="connector">
      {heading ? <h3 className="section-title">Claude connector</h3> : null}
      <p className="dim" style={{ marginTop: 0 }}>
        Ask Claude about your fleet: how today went, the multi-day report, what is coming up, or to queue a request.
      </p>
      <div className="connector-url">
        <code>{connector.url}</code>
        <button type="button" className="button" onClick={() => void copy()}>
          <Copy size={16} aria-hidden="true" /> {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {connector.ready ? (
        <p className="tone-good connector-state">
          <CheckCircle2 size={18} aria-hidden="true" /> Ready for Claude to connect.
        </p>
      ) : (
        <p className="tone-bad connector-state">
          <XCircle size={18} aria-hidden="true" /> Not ready: {connector.reason ?? 'the deployment is not set up yet.'}
        </p>
      )}
      <ul className="connector-steps">
        <li>
          <strong>Claude app:</strong> Settings → Connectors → Add custom connector, paste the URL, leave the OAuth fields blank,
          sign in with the page password.
        </li>
        <li>
          <strong>Claude Code:</strong> <code>{command}</code> then <code>/mcp</code>.
        </li>
      </ul>

      <div className="connector-head">
        <h4>Live connections{connector.connections !== null ? ` (${connector.connections})` : ''}</h4>
        {grants && grants.length > 1 ? (
          <button type="button" className="archive-button" onClick={() => void revokeAll()} disabled={demo}>
            Revoke all
          </button>
        ) : null}
      </div>
      {demo ? <p className="demo-note">An example: the demo has no live connections, so nothing here can be revoked.</p> : null}
      {error ? (
        <Notice tone="bad">
          <p>{error}</p>
        </Notice>
      ) : null}
      {grants === null ? (
        !error ? <p className="muted">Loading the connections…</p> : null
      ) : grants.length ? (
        <div style={{ overflowX: 'auto' }}>
          <table className="token-table">
            <thead>
              <tr>
                <th scope="col">Client</th>
                <th scope="col">Connected</th>
                <th scope="col">Last used</th>
                <th scope="col">Ends</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {grants.map((g) => (
                <tr key={g.grant_id}>
                  <td>
                    <strong>{g.client_name ?? g.client_id}</strong>
                    <span className="dim">
                      {' '}
                      from {g.redirect_hosts.map((h) => CONNECTED_FROM[h] ?? h).join(', ') || 'an unknown place'}
                    </span>
                  </td>
                  <td title={fmtDate(g.created_at)}>{fmtAgo(g.created_at, Date.now())}</td>
                  <td>{g.last_used_at ? fmtAgo(g.last_used_at, Date.now()) : <span className="muted">not yet</span>}</td>
                  <td title={fmtDate(g.expires_at)}>{fmtDate(g.expires_at)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button type="button" className="archive-button" onClick={() => void revoke(g)} disabled={demo}>
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">No connections. Once Claude signs in, it shows here.</p>
      )}
      {grants && grants.length === 1 ? (
        <p style={{ marginBottom: 0 }}>
          <button type="button" className="archive-button" onClick={() => void revokeAll()} disabled={demo}>
            Revoke all
          </button>
        </p>
      ) : null}
    </div>
  )
}

function FleetTokens() {
  const [tokens, setTokens] = useState<FleetToken[] | null>(null)
  const [label, setLabel] = useState('')
  const [minted, setMinted] = useState<MintedToken | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(() => {
    cloud
      .tokens()
      .then(setTokens)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [])
  useEffect(load, [load])

  const mint = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      const token = await cloud.mint(label)
      setMinted(token)
      setLabel('')
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const revoke = async (token: FleetToken) => {
    if (!window.confirm(`Revoke the token for "${token.label}"? That Mac stops relaying at its next send.`)) return
    try {
      await cloud.revoke(token.id)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const rename = async (token: FleetToken) => {
    const next = window.prompt('A new name for this Mac', token.label)
    if (!next || next.trim() === token.label) return
    try {
      await cloud.rename(token.id, next.trim())
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const copy = async () => {
    if (!minted) return
    try {
      await navigator.clipboard.writeText(minted.token)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <>
      <h3 className="section-title">Fleet machines</h3>
      <p className="dim" style={{ marginTop: 0 }}>
        Each Mac relays with its own token. Revoke one and that Mac stops at its next send; the others carry on.
      </p>
      {error ? (
        <Notice tone="bad">
          <p>{error}</p>
        </Notice>
      ) : null}
      <form onSubmit={mint} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '10px 0' }}>
        <label className="visually-hidden" htmlFor="token-label">
          Name of the Mac
        </label>
        <input
          id="token-label"
          className="input"
          style={{ flex: '1 1 220px' }}
          placeholder="Which Mac, e.g. studio-mbp"
          value={label}
          maxLength={80}
          onChange={(e) => setLabel(e.target.value)}
          required
        />
        <button type="submit" className="button primary">
          <KeyRound size={16} aria-hidden="true" /> Mint a token
        </button>
      </form>
      {minted ? (
        <div className="secret-once" role="status">
          <strong>Copy this token for {minted.label} now. It is shown once.</strong>
          <code>{minted.token}</code>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button type="button" className="button" onClick={() => void copy()}>
              <Copy size={16} aria-hidden="true" /> {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" className="button" onClick={() => setMinted(null)}>
              I have saved it
            </button>
          </div>
          <p className="dim" style={{ marginBottom: 0 }}>
            Put it on that Mac as <code>CLUB_RELAY_TOKEN</code>. Only a hash of it is stored here.
          </p>
        </div>
      ) : null}
      {tokens === null ? (
        <p className="muted">Loading the tokens…</p>
      ) : tokens.length ? (
        <div style={{ overflowX: 'auto' }}>
          <table className="token-table">
            <thead>
              <tr>
                <th scope="col">Mac</th>
                <th scope="col">Minted</th>
                <th scope="col">Last relayed</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.label}</strong>
                    {t.revoked_at ? <span className="tone-bad"> revoked {fmtDate(t.revoked_at)}</span> : null}
                  </td>
                  <td title={fmtDate(t.created_at)}>{fmtAgo(t.created_at, Date.now())}</td>
                  <td>{t.last_seen_at ? fmtAgo(t.last_seen_at, Date.now()) : <span className="muted">never</span>}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {t.revoked_at ? null : (
                      <>
                        <button type="button" className="archive-button" onClick={() => void rename(t)}>
                          Rename
                        </button>{' '}
                        <button type="button" className="archive-button" onClick={() => void revoke(t)}>
                          Revoke
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">No Mac is connected yet. Mint a token for the first one.</p>
      )}
    </>
  )
}
