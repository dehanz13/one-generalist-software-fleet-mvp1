/**
 * An Excalidraw diagram from the docs. Each one is committed three ways
 * (see modernized/docs/diagrams/README.md): a light SVG, a dark SVG and the
 * .excalidraw scene. Both SVGs are images, never inlined markup, and CSS
 * shows the one that matches the theme, so a theme switch needs no script.
 */
import { Download, Maximize2 } from 'lucide-react'

const svgUrls = import.meta.glob('./content/diagrams/*.svg', { query: '?url', import: 'default', eager: true }) as Record<
  string,
  string
>
const sceneUrls = import.meta.glob('./content/diagrams/*.excalidraw', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>

export interface DiagramFiles {
  light: string
  dark: string
  scene: string | null
}

/** The diagram a Markdown image points at (`diagrams/<name>.svg`), or null. */
export function diagramName(src: string): string | null {
  const match = /(?:^|\/)diagrams\/([\w-]+)\.svg$/.exec(src)
  return match ? match[1]! : null
}

export function diagramFiles(name: string): DiagramFiles | null {
  const light = svgUrls[`./content/diagrams/${name}.svg`]
  if (!light) return null
  return {
    light,
    dark: svgUrls[`./content/diagrams/${name}.dark.svg`] ?? light,
    scene: sceneUrls[`./content/diagrams/${name}.excalidraw`] ?? null,
  }
}

export function Diagram({ name, alt }: { name: string; alt: string }) {
  const files = diagramFiles(name)
  if (!files) {
    return <p className="doc-missing">Diagram “{alt}” is missing from this build.</p>
  }
  return (
    <figure className="doc-figure">
      <div className="doc-figure-frame">
        <a className="doc-figure-variant doc-figure-light" href={files.light} target="_blank" rel="noopener noreferrer" title="Open full size">
          <img src={files.light} alt={alt} loading="lazy" decoding="async" />
        </a>
        <a className="doc-figure-variant doc-figure-dark" href={files.dark} target="_blank" rel="noopener noreferrer" title="Open full size">
          <img src={files.dark} alt={alt} loading="lazy" decoding="async" />
        </a>
      </div>
      <figcaption>
        <span className="doc-figure-title">{alt}</span>
        <span className="doc-figure-links">
          <a className="doc-figure-light" href={files.light} target="_blank" rel="noopener noreferrer">
            <Maximize2 size={14} aria-hidden="true" /> Full size
          </a>
          <a className="doc-figure-dark" href={files.dark} target="_blank" rel="noopener noreferrer">
            <Maximize2 size={14} aria-hidden="true" /> Full size
          </a>
          {files.scene ? (
            <a href={files.scene} download={`${name}.excalidraw`}>
              <Download size={14} aria-hidden="true" /> Download the Excalidraw scene
            </a>
          ) : null}
        </span>
      </figcaption>
    </figure>
  )
}
