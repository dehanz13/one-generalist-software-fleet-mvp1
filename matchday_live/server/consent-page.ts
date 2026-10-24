/**
 * The connector's sign-in and consent page, rendered on the server.
 *
 * No script, no external asset, no inline style attribute: one <style>
 * element whose SHA-256 is the only style the page's Content-Security-Policy
 * allows. Every value from the request is HTML-escaped. The form posts back
 * to /oauth/authorize; its CSP allows that, and the one redirect origin the
 * form leads to (form-action covers redirects after a submission).
 */
import { createHash } from 'node:crypto'

const CSS = `
:root{color-scheme:light dark;--bg:#0f1512;--panel:#17201b;--ink:#eef3ef;--muted:#a9b8ae;--line:#2b3a31;--accent:#3ddc84;--warn:#ffb020;--bad:#ff6b6b}
@media (prefers-color-scheme:light){:root{--bg:#f4f7f5;--panel:#ffffff;--ink:#14201a;--muted:#4f6157;--line:#d5e0d9;--accent:#127a43;--warn:#8a5a00;--bad:#b42318}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{width:100%;max-width:520px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:24px}
h1{font-size:1.35rem;margin:0 0 4px}
p{margin:0 0 12px}
.muted{color:var(--muted);font-size:.92rem}
.who{border-left:3px solid var(--accent);padding:8px 12px;margin:16px 0;background:color-mix(in srgb,var(--accent) 8%,transparent)}
.warn{border-left:3px solid var(--warn);padding:8px 12px;margin:0 0 16px;color:var(--warn)}
.error{border-left:3px solid var(--bad);padding:8px 12px;margin:0 0 16px;color:var(--bad)}
h2{font-size:1rem;margin:16px 0 6px}
ul{margin:0 0 12px;padding-left:20px}
li{margin:2px 0}
code{font-family:ui-monospace,Menlo,monospace;font-size:.9em;overflow-wrap:anywhere}
label{display:block;font-weight:600;margin:16px 0 6px}
input[type=password]{width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--ink);font:inherit}
.buttons{display:flex;gap:12px;margin-top:16px;flex-wrap:wrap}
button{flex:1 1 140px;padding:10px 16px;border-radius:8px;border:1px solid var(--line);font:inherit;font-weight:600;cursor:pointer;background:var(--bg);color:var(--ink)}
button.allow{background:var(--accent);border-color:var(--accent);color:#06140c}
`

/** The CSP hash of the page's one style element. */
export const STYLE_HASH = `'sha256-${createHash('sha256').update(CSS).digest('base64')}'`

/** An origin plain enough to sit in a CSP source list: a scheme, a host of letters, digits, dots and dashes, a port. */
const PLAIN_ORIGIN = /^https?:\/\/[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*(?::\d{1,5})?$/

/**
 * The page's Content-Security-Policy: nothing but its own style, and a form
 * that may lead only here and to `redirectOrigin` (an origin that is not
 * plain is left out, so it can never add to the policy).
 */
export function consentCsp(redirectOrigin: string | null): string {
  const formAction = ["'self'", ...(redirectOrigin && PLAIN_ORIGIN.test(redirectOrigin) ? [redirectOrigin] : [])].join(' ')
  return [
    "default-src 'none'",
    `style-src ${STYLE_HASH}`,
    `form-action ${formAction}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join('; ')
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="same-origin">
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`
}

export interface ConsentView {
  clientName: string | null
  clientId: string
  /** Where the browser is sent back to: its host, as the person should read it. */
  redirectHost: string
  /** True when the client may only send people back to this computer. */
  loopbackOnly: boolean
  /** Every authorization parameter, carried through the form unchanged. */
  hidden: Record<string, string>
  error: string | null
}

/** The sign-in and consent page. */
export function consentPage(view: ConsentView): string {
  const name = view.clientName ? escapeHtml(view.clientName) : 'An application'
  const hidden = Object.entries(view.hidden)
    .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`)
    .join('\n')
  return page(
    'Connect to Matchday Live',
    `<h1>Connect to Matchday Live</h1>
<p class="muted">The live view of your software fleet.</p>
${view.error ? `<p class="error" role="alert">${escapeHtml(view.error)}</p>` : ''}
<div class="who">
<p><strong>${name}</strong> wants to connect to this Matchday Live.</p>
<p class="muted">It names itself; this page cannot check that name. After you answer, your browser goes to <strong>${escapeHtml(view.redirectHost)}</strong>.</p>
</div>
${
  view.loopbackOnly
    ? `<p class="warn">This client sends you back to a program on this computer. Allow it only if you just started the connection yourself, for example from Claude Code.</p>`
    : ''
}
<h2>If you allow it, it can</h2>
<ul>
<li>read your matches, their objectives, players, reviews and reports;</li>
<li>read the daily and multi-day reports, with every agent's performance;</li>
<li>read Upcoming Matches and the run requests;</li>
<li>queue a run request (a set piece with a prompt, or a planned ticket) and cancel one no Mac has taken yet.</li>
</ul>
<h2>It cannot</h2>
<ul>
<li>run anything on a Mac whose Scheduler does not accept remote requests, or a set piece that Mac does not allow;</li>
<li>see this password, the fleet tokens or any setting, archive matches, or apply the schema.</li>
</ul>
<p class="muted">The connection lasts until you revoke it on the Connections page. Its access token lasts an hour and is renewed by the client.</p>
<form method="post" action="/oauth/authorize">
${hidden}
<label for="password">Matchday Live password</label>
<input id="password" name="password" type="password" autocomplete="current-password" autofocus>
<div class="buttons">
<button class="allow" type="submit" name="decision" value="allow">Allow</button>
<button type="submit" name="decision" value="deny">Deny</button>
</div>
</form>
<p class="muted">Client id: <code>${escapeHtml(view.clientId)}</code></p>`,
  )
}

/** A page for a request that cannot go back to the client: an unknown client, a redirect URI it never registered. */
export function errorPage(message: string): string {
  return page(
    'Matchday Live: cannot connect',
    `<h1>Cannot connect</h1>
<p class="error" role="alert">${escapeHtml(message)}</p>
<p class="muted">Nothing was shared. Close this tab and start the connection again from the app.</p>`,
  )
}
