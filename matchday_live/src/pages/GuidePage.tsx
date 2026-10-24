/**
 * Guide: step by step, how to run the fleet on your own work. The pages are
 * modernized/docs/guide/*.md, copied in by `node docs/sync.mjs`.
 */
import { DocsLayout } from '../docs/DocsLayout'

export function GuidePage({ slug }: { slug: string | null }) {
  return <DocsLayout section="guide" slug={slug} />
}
