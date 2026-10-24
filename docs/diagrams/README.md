# Diagrams

Every diagram in the docs is a real Excalidraw scene, drawn by Excalidraw
itself. Each one is three committed files:

| File | What it is |
|---|---|
| `<name>.excalidraw` | the scene: open it at excalidraw.com (File, Open) or in the VS Code extension to edit it by hand |
| `<name>.svg` | Excalidraw's own SVG export, light, with its font embedded |
| `<name>.dark.svg` | the same, dark: the colours Excalidraw's dark mode gives, baked in |

The scenes are written as code in `scenes/*.mjs` (one file per diagram, with
the helpers in `scenes/lib.mjs`), so a change is a reviewable diff and the
layout stays consistent. `export.mjs` turns them into the files above with
Excalidraw's own `convertToExcalidrawElements`, `serializeAsJSON` and
`exportToSvg`, in headless Chromium.

## Re-export everything

```sh
cd docs/diagrams
npm install          # once: Excalidraw, Vite and Playwright, for this folder only
npm run export       # every scene, then docs/sync.mjs copies the docs into Matchday Live
```

If Playwright says its browser is missing, run `npx playwright install chromium` once.

One scene, or a PNG of each to look at:

```sh
node export.mjs components
node export.mjs --preview /some/folder     # writes ogsf-diagram-<name>-light.png and -dark.png there
```

The export never reaches the network: the page is served from this folder,
every other request is refused, and the font comes from
`node_modules/@excalidraw/excalidraw`. A request that would have left the
machine fails the export instead of being made. Nothing is ever uploaded to
excalidraw.com.

## Rules the export enforces

- **Only characters the embedded font has.** Excalifont's Latin face covers
  ASCII, Latin-1 and typographic punctuation (– — ‘ ’ “ ” • …). An arrow
  character or an emoji would be drawn by whatever font the reader's machine
  has, so the export refuses it: write "to" instead of an arrow.
- **Labels are measured in Excalifont.** The font is loaded before any
  element is made, so every box is sized for the text it holds.

## The diagrams

| Name | Shows |
|---|---|
| `components` | everything in the fleet and what talks to what |
| `match-sequence` | one `run-heroic` match as a sequence: reports traded, a correction in the same session |
| `difficulty-normal-heroic` | `run-normal` and `run-heroic`, objective by objective, with extra time |
| `difficulty-mythic` | `run-mythic`: kickoff checklist, ruling stop, line of scrimmage, scope check, progressive gate |
| `correction-loops` | the three checks on every player call: JSON fix, official review correction, restricted-area rollback |
| `matchday-live-data-flow` | a row from the match runner to the page, locally and through the cloud |
| `upcoming-scheduler` | Upcoming Matches, requests and the Scheduler |
| `remote-control` | Claude Code Remote Control and the Matchday Live connector |

`package.json` here is development tooling only. Matchday Live never
depends on it: the page reads the committed `.svg` files.
