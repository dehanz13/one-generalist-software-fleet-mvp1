/**
 * Why a version 2 page could not load, said plainly: sign in, an `ogsf` or
 * deployment older than this page, or the server's own message.
 */
import { ApiFailure, isMissingRoute } from '../data/source'
import { hrefFor } from '../lib/router'
import { Notice } from './common'

export function LoadError({ error, what }: { error: Error | null; what: string }) {
  if (!error) return null
  if (error instanceof ApiFailure && error.status === 401) {
    return (
      <Notice tone="warn">
        <p>
          The cloud store needs you to sign in to see {what}. <a href={hrefFor({ page: 'sign-in' })}>Sign in</a>, or{' '}
          <a href={hrefFor({ page: 'connections' })}>watch the demo or a local fleet instead</a>.
        </p>
      </Notice>
    )
  }
  if (isMissingRoute(error)) {
    return (
      <Notice tone="warn">
        <p>
          This fleet does not serve {what} yet: its <code>ogsf</code> (or this deployment) is older than this page. Update{' '}
          <code>ogsf</code> on that Mac and restart <code>ogsf var</code>, or redeploy the cloud, then reload. Everything else keeps
          working.
        </p>
      </Notice>
    )
  }
  return (
    <Notice tone="bad">
      <p>{error.message}</p>
    </Notice>
  )
}
