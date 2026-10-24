/**
 * Docs: how the fleet works and what it is made of. The pages are
 * modernized/docs/*.md, copied in by `node docs/sync.mjs`.
 */
import { DocsLayout } from '../docs/DocsLayout'

export function DocsPage({ slug }: { slug: string | null }) {
  return <DocsLayout section="docs" slug={slug} />
}
