import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export const STYLE = {
  bg: '#0a0a0a',
  text: '#e9ecef',
  nodeStroke: '#e9ecef',
  containerStroke: '#ced4da',
  frameStroke: '#e03131',
  arrow: '#e9ecef',
}

export function createMapContext() {
  let nonce = 1
  const registry = new Map()

  function uid(prefix = 'el') {
    nonce += 1
    return `${prefix}_${nonce}_${Math.random().toString(36).slice(2, 9)}`
  }

  function randSeed() {
    return Math.floor(Math.random() * 2 ** 31)
  }

  function baseFields(type) {
    const id = uid(type)
    return {
      id,
      type,
      angle: 0,
      strokeColor: STYLE.nodeStroke,
      backgroundColor: 'transparent',
      fillStyle: 'solid',
      strokeWidth: 1,
      strokeStyle: 'solid',
      roughness: 0,
      opacity: 100,
      seed: randSeed(),
      version: 1,
      versionNonce: randSeed(),
      isDeleted: false,
      groupIds: [],
      frameId: null,
      boundElements: [],
      updated: Date.now(),
      link: null,
      locked: false,
    }
  }

  function estimateTextWidth(text, fontSize) {
    return Math.max(fontSize * 2, text.length * fontSize * 0.55)
  }

  function createText({ x, y, text, fontSize = 16, strokeColor = STYLE.text, containerId = null, textAlign = 'center', verticalAlign = 'middle', width }) {
    const w = width ?? estimateTextWidth(text, fontSize)
    const h = fontSize * 1.35
    return {
      ...baseFields('text'),
      x,
      y,
      width: w,
      height: h,
      text,
      originalText: text,
      fontSize,
      fontFamily: 1,
      textAlign,
      verticalAlign,
      containerId,
      autoResize: true,
      lineHeight: 1.25,
      strokeColor,
    }
  }

  function createRectangle({ x, y, width, height, strokeColor = STYLE.nodeStroke, roundness = 3, label = null, fontSize = 16 }) {
    const rect = {
      ...baseFields('rectangle'),
      x,
      y,
      width,
      height,
      strokeColor,
      roundness: { type: roundness },
    }

    const elements = [rect]

    if (label) {
      const tw = estimateTextWidth(label, fontSize)
      const th = fontSize * 1.35
      const text = createText({
        x: x + (width - tw) / 2,
        y: y + (height - th) / 2,
        text: label,
        fontSize,
        containerId: rect.id,
        width: tw,
      })
      rect.boundElements.push({ id: text.id, type: 'text' })
      elements.push(text)
    }

    return { rect, elements }
  }

  function register(name, rect) {
    registry.set(name, rect)
    return rect
  }

  function box(name, { x, y, w, h, label, fontSize = 16, strokeColor = STYLE.nodeStroke }) {
    const { rect, elements } = createRectangle({ x, y, width: w, height: h, label, fontSize, strokeColor })
    register(name, rect)
    return elements
  }

  function container(name, { x, y, w, h, title, titleSize = 20, strokeColor = STYLE.containerStroke }) {
    const { rect, elements } = createRectangle({ x, y, width: w, height: h, strokeColor, roundness: 3 })
    const titleEl = createText({
      x: x + 16,
      y: y + 12,
      text: title,
      fontSize: titleSize,
      textAlign: 'left',
      verticalAlign: 'top',
      strokeColor: STYLE.text,
    })
    rect.boundElements.push({ id: titleEl.id, type: 'text' })
    register(name, rect)
    return [...elements, titleEl]
  }

  function pickFocus(self, other) {
    const scx = self.x + self.width / 2
    const scy = self.y + self.height / 2
    const ocx = other.x + other.width / 2
    const ocy = other.y + other.height / 2
    const dx = ocx - scx
    const dy = ocy - scy
    if (Math.abs(dx) > Math.abs(dy)) {
      return dx > 0 ? 'right' : 'left'
    }
    return dy > 0 ? 'bottom' : 'top'
  }

  function edge(fromName, toName, { dashed = false, label = null } = {}) {
    const from = registry.get(fromName)
    const to = registry.get(toName)
    if (!from || !to) {
      throw new Error(`Edge ${fromName} -> ${toName}: node not found`)
    }

    const fromCx = from.x + from.width / 2
    const fromCy = from.y + from.height / 2
    const toCx = to.x + to.width / 2
    const toCy = to.y + to.height / 2

    const dx = toCx - fromCx
    const dy = toCy - fromCy

    const arrow = {
      ...baseFields('arrow'),
      x: fromCx,
      y: fromCy,
      width: dx,
      height: dy,
      strokeColor: STYLE.arrow,
      strokeStyle: dashed ? 'dashed' : 'solid',
      roundness: { type: 2 },
      points: [
        [0, 0],
        [dx, dy],
      ],
      lastCommittedPoint: null,
      startBinding: {
        elementId: from.id,
        focus: pickFocus(from, to),
        gap: 4,
      },
      endBinding: {
        elementId: to.id,
        focus: pickFocus(to, from),
        gap: 4,
      },
      startArrowhead: null,
      endArrowhead: 'arrow',
    }

    from.boundElements.push({ id: arrow.id, type: 'arrow' })
    to.boundElements.push({ id: arrow.id, type: 'arrow' })

    const elements = [arrow]

    if (label) {
      const midX = fromCx + dx / 2 - estimateTextWidth(label, 14) / 2
      const midY = fromCy + dy / 2 - 10
      elements.push(createText({ x: midX, y: midY, text: label, fontSize: 14, textAlign: 'center' }))
    }

    return elements
  }

  return { box, container, edge }
}

export function buildScene(elements) {
  return {
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements,
    appState: {
      theme: 'dark',
      viewBackgroundColor: STYLE.bg,
      gridSize: null,
      scrollX: 0,
      scrollY: 0,
      zoom: { value: 0.65 },
      currentItemStrokeColor: STYLE.nodeStroke,
      currentItemBackgroundColor: 'transparent',
    },
    files: {},
  }
}

export function validateScene(scene) {
  if (!Array.isArray(scene.elements) || scene.elements.length === 0) {
    throw new Error('Scene has no elements')
  }
  const ids = new Set(scene.elements.map((e) => e.id))
  for (const el of scene.elements) {
    if (el.isDeleted) throw new Error(`Element ${el.id} is deleted`)
    if (!el.type || !ids.has(el.id)) throw new Error(`Invalid element ${el.id}`)
    for (const bound of el.boundElements ?? []) {
      if (!ids.has(bound.id)) {
        throw new Error(`Missing bound element ${bound.id} on ${el.id}`)
      }
    }
    if (el.startBinding && !ids.has(el.startBinding.elementId)) {
      throw new Error(`Missing startBinding target on arrow ${el.id}`)
    }
    if (el.endBinding && !ids.has(el.endBinding.elementId)) {
      throw new Error(`Missing endBinding target on arrow ${el.id}`)
    }
  }
}

export function writeScene(outPath, scene) {
  validateScene(scene)
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, `${JSON.stringify(scene, null, 2)}\n`, 'utf8')
  console.log(`Generated ${outPath} (${scene.elements.length} elements)`)
}
