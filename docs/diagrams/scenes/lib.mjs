// Helpers that write Excalidraw element skeletons: the input of Excalidraw's
// own `convertToExcalidrawElements`, which turns them into full elements
// (bound labels, bound arrows) in the export page. The scene files written
// from them are ordinary .excalidraw files: open one in Excalidraw to edit it.
//
// Every scene module exports `{ name, title, build }`; `build()` returns the
// skeleton list. A fresh `Scene` per build keeps ids and positions local.

/** Excalidraw's own palette (open-color), stroke and fill. */
export const COLOR = {
  blue: { stroke: '#1971c2', fill: '#a5d8ff' },
  violet: { stroke: '#6741d9', fill: '#d0bfff' },
  green: { stroke: '#2f9e44', fill: '#b2f2bb' },
  orange: { stroke: '#e8590c', fill: '#ffd8a8' },
  red: { stroke: '#e03131', fill: '#ffc9c9' },
  teal: { stroke: '#0c8599', fill: '#99e9f2' },
  yellow: { stroke: '#f08c00', fill: '#ffec99' },
  pink: { stroke: '#c2255c', fill: '#fcc2d7' },
  grey: { stroke: '#495057', fill: '#e9ecef' },
  white: { stroke: '#1e1e1e', fill: '#ffffff' },
}

/** The players' colours, as the shipped club.config.yaml gives them, in the nearest palette entry. */
export const ROLE = {
  founder: 'orange',
  playmaker: 'violet',
  builder: 'teal',
  ranger: 'yellow',
  safety_officer: 'red',
  bard: 'pink',
  referee: 'grey',
  runner: 'blue',
}

export const INK = '#1e1e1e'
export const MUTED = '#495057'

/** Excalifont, Excalidraw's hand-drawn face. */
const HAND = 5

export class Scene {
  constructor() {
    this.items = []
    this.shapes = new Map()
    this.count = 0
  }

  id(prefix) {
    this.count += 1
    return `${prefix}-${this.count}`
  }

  /** A filled shape with a centred label. kind: rectangle | ellipse | diamond. */
  shape(kind, id, x, y, width, height, text, color = 'blue', opts = {}) {
    const c = COLOR[color] ?? COLOR.blue
    const el = {
      type: kind,
      id,
      x,
      y,
      width,
      height,
      strokeColor: opts.stroke ?? c.stroke,
      backgroundColor: opts.fill ?? c.fill,
      fillStyle: opts.fillStyle ?? 'solid',
      strokeWidth: opts.strokeWidth ?? 2,
      strokeStyle: opts.strokeStyle ?? 'solid',
      roughness: opts.roughness ?? 1,
      roundness: kind === 'rectangle' ? { type: 3 } : null,
    }
    if (text) {
      el.label = {
        text,
        fontSize: opts.fontSize ?? 18,
        fontFamily: HAND,
        strokeColor: opts.ink ?? INK,
        textAlign: opts.align ?? 'center',
        verticalAlign: opts.valign ?? 'middle',
      }
    }
    this.items.push(el)
    this.shapes.set(id, { x, y, width, height })
    return id
  }

  box(id, x, y, w, h, text, color, opts) {
    return this.shape('rectangle', id, x, y, w, h, text, color, opts)
  }

  ellipse(id, x, y, w, h, text, color, opts) {
    return this.shape('ellipse', id, x, y, w, h, text, color, opts)
  }

  diamond(id, x, y, w, h, text, color, opts) {
    return this.shape('diamond', id, x, y, w, h, text, color, opts)
  }

  /** A dashed, unfilled area with a title at its top left (or bottom left): "Your Mac", "The cloud". */
  zone(id, x, y, w, h, title, color = 'grey', opts = {}) {
    const c = COLOR[color] ?? COLOR.grey
    this.items.push({
      type: 'rectangle',
      id,
      x,
      y,
      width: w,
      height: h,
      strokeColor: c.stroke,
      backgroundColor: 'transparent',
      fillStyle: 'solid',
      strokeWidth: 2,
      strokeStyle: 'dashed',
      roughness: 1,
      roundness: { type: 3 },
    })
    this.text(x + 18, opts.titleAt === 'bottom' ? y + h - 42 : y + 12, title, { fontSize: 24, color: c.stroke })
    return id
  }

  /** A small label beside a line, for arrows whose own label would sit on a corner. */
  note(x, y, text, opts = {}) {
    this.text(x, y, text, { fontSize: 16, ...opts })
  }

  /** Free text. */
  text(x, y, text, opts = {}) {
    this.items.push({
      type: 'text',
      id: this.id('t'),
      x,
      y,
      text,
      fontSize: opts.fontSize ?? 18,
      fontFamily: HAND,
      strokeColor: opts.color ?? INK,
      textAlign: opts.align ?? 'left',
    })
  }

  // ── sequence diagrams ──

  /** Moves everything drawn since `mark` (an items.length) under what came before it. */
  sendToBack(mark) {
    this.items.unshift(...this.items.splice(mark))
  }

  /** A participant: a box on top and a dashed line down to `bottom`. */
  lifeline(id, x, top, bottom, text, color, w = 190, h = 76) {
    this.box(id, x - w / 2, top, w, h, text, color)
    this.path(
      [
        [x, top + h],
        [x, bottom],
      ],
      { plain: true, dashed: true, color: 'grey', strokeWidth: 1 },
    )
  }

  /** A message between two lifelines, its text above the line. A reply is dashed. */
  message(fromX, toX, y, text, opts = {}) {
    const dir = toX > fromX ? 1 : -1
    this.path(
      [
        [fromX + dir * 3, y],
        [toX - dir * 3, y],
      ],
      { dashed: opts.reply, color: opts.color },
    )
    const ink = opts.color ? COLOR[opts.color].stroke : INK
    this.text(Math.min(fromX, toX) + 26, y - 25, text, { fontSize: opts.fontSize ?? 17, color: ink })
  }

  /** A step a participant takes by itself: a loop back onto its own line, text to the right. */
  selfCall(x, y, text, opts = {}) {
    this.path(
      [
        [x + 3, y],
        [x + 44, y],
        [x + 44, y + 28],
        [x + 5, y + 28],
      ],
      { color: opts.color },
    )
    const ink = opts.color ? COLOR[opts.color].stroke : INK
    this.text(x + 56, y + (opts.lines === 2 ? -8 : 2), text, { fontSize: opts.fontSize ?? 17, color: ink })
  }

  /** Where an arrow leaves or enters a shape on a side. */
  port(id, side, offset = 0) {
    const s = this.shapes.get(id)
    if (!s) throw new Error(`no shape ${id}`)
    switch (side) {
      case 'right':
        return [s.x + s.width, s.y + s.height / 2 + offset]
      case 'left':
        return [s.x, s.y + s.height / 2 + offset]
      case 'top':
        return [s.x + s.width / 2 + offset, s.y]
      case 'bottom':
        return [s.x + s.width / 2 + offset, s.y + s.height]
      default:
        throw new Error(`no side ${side}`)
    }
  }

  /** The sides two shapes face each other on. */
  sides(from, to) {
    const a = this.shapes.get(from)
    const b = this.shapes.get(to)
    const dx = b.x + b.width / 2 - (a.x + a.width / 2)
    const dy = b.y + b.height / 2 - (a.y + a.height / 2)
    if (Math.abs(dx) * 0.6 > Math.abs(dy)) return dx > 0 ? ['right', 'left'] : ['left', 'right']
    return dy > 0 ? ['bottom', 'top'] : ['top', 'bottom']
  }

  /**
   * An arrow bound to two shapes. `via` are extra corner points (absolute)
   * between the two ends, for an elbowed route; `startAt`/`endAt` pin an end
   * to a point (a diamond's edge, say) instead of the middle of a side.
   */
  arrow(from, to, opts = {}) {
    const [fromSide, toSide] = opts.sides ?? this.sides(from, to)
    const [sx, sy] = opts.startAt ?? this.port(from, fromSide, opts.fromOffset ?? 0)
    const [ex, ey] = opts.endAt ?? this.port(to, toSide, opts.toOffset ?? 0)
    const corners = opts.via ?? []
    const points = [[0, 0], ...corners.map(([x, y]) => [x - sx, y - sy]), [ex - sx, ey - sy]]
    return this.line(sx, sy, points, { ...opts, start: from, end: to })
  }

  /** An arrow between two absolute points, bound to nothing (sequence messages). */
  path(points, opts = {}) {
    const [sx, sy] = points[0]
    return this.line(sx, sy, points.map(([x, y]) => [x - sx, y - sy]), opts)
  }

  line(x, y, points, opts) {
    const c = COLOR[opts.color ?? 'white']
    const xs = points.map((p) => p[0])
    const ys = points.map((p) => p[1])
    const el = {
      type: opts.plain ? 'line' : 'arrow',
      id: opts.id ?? this.id('a'),
      x,
      y,
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
      points,
      strokeColor: opts.color ? c.stroke : INK,
      strokeWidth: opts.strokeWidth ?? 2,
      strokeStyle: opts.dashed ? 'dashed' : opts.dotted ? 'dotted' : 'solid',
      roughness: 1,
    }
    if (!opts.plain) {
      el.endArrowhead = opts.endArrowhead === undefined ? 'arrow' : opts.endArrowhead
      el.startArrowhead = opts.both ? 'arrow' : null
      if (opts.start) el.start = { id: opts.start }
      if (opts.end) el.end = { id: opts.end }
    }
    if (opts.label) {
      el.label = { text: opts.label, fontSize: opts.labelSize ?? 16, fontFamily: HAND, strokeColor: opts.labelColor ?? INK }
    }
    this.items.push(el)
    return el.id
  }
}
