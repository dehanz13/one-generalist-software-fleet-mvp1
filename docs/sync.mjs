// Copies the docs into Matchday Live, so the page shows exactly what GitHub
// shows. Run after editing any page or diagram (`npm run export` in
// diagrams/ runs it too):
//
//   node docs/sync.mjs
//
//   docs/*.md                    → matchday_live/src/docs/content/docs/
//   docs/guide/*.md              → matchday_live/src/docs/content/guide/
//   docs/diagrams/*.svg          → matchday_live/src/docs/content/diagrams/
//   docs/diagrams/*.excalidraw   → matchday_live/src/docs/content/diagrams/
//
// The content folder is generated: everything in it is replaced. README.md
// is GitHub's index of these pages; the page builds its own.
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const docs = dirname(fileURLToPath(import.meta.url))
const content = join(docs, '..', 'matchday_live', 'src', 'docs', 'content')

const plan = [
  { from: docs, to: 'docs', keep: (f) => f.endsWith('.md') && f !== 'README.md' },
  { from: join(docs, 'guide'), to: 'guide', keep: (f) => f.endsWith('.md') && f !== 'README.md' },
  { from: join(docs, 'diagrams'), to: 'diagrams', keep: (f) => f.endsWith('.svg') || f.endsWith('.excalidraw') },
]

await rm(content, { recursive: true, force: true })
let copied = 0
for (const step of plan) {
  const target = join(content, step.to)
  await mkdir(target, { recursive: true })
  const files = (await readdir(step.from, { withFileTypes: true })).filter((e) => e.isFile() && step.keep(e.name))
  for (const file of files) {
    await copyFile(join(step.from, file.name), join(target, file.name))
    copied += 1
  }
}
console.log(`synced ${copied} files into ${content}`)
