import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Donut, Legend, SegmentedBar, AreaTrend, type ChartDatum } from './Charts'

const data: ChartDatum[] = [
  { label: 'A', value: 3, color: '#ff0000' },
  { label: 'B', value: 1, color: '#00ff00' },
  { label: 'C', value: 0, color: '#0000ff' },
]
const count = (html: string, tag: string) => (html.match(new RegExp(`<${tag}[ >]`, 'g')) ?? []).length

describe('Donut', () => {
  it('draws one base ring + one circle per non-zero segment, with total in center', () => {
    const out = renderToStaticMarkup(<Donut data={data} />)
    expect(count(out, 'circle')).toBe(3) // base + 2 non-zero (C is 0 → skipped)
    expect(out).toContain('stroke="#ff0000"')
    expect(out).toContain('stroke="#00ff00"')
    expect(out).not.toContain('stroke="#0000ff"')
    expect(out).toContain('>4<') // centerValue defaults to total (3+1)
  })
  it('renders only the grey base ring when everything is zero', () => {
    const out = renderToStaticMarkup(<Donut data={[{ label: 'x', value: 0, color: '#abc' }]} />)
    expect(count(out, 'circle')).toBe(1)
    expect(out).toContain('var(--color-hover)')
  })
})

describe('SegmentedBar', () => {
  it('renders one slice per non-zero segment', () => {
    const out = renderToStaticMarkup(<SegmentedBar segments={data} />)
    // 1 track + 2 non-zero slices = 3 divs
    expect(count(out, 'div')).toBe(3)
    expect(out).toContain('title="A: 3"')
    expect(out).toContain('title="B: 1"')
  })
})

describe('AreaTrend', () => {
  it('renders an area path, a line and per-point labels/values', () => {
    const out = renderToStaticMarkup(<AreaTrend points={[{ label: '01/06', value: 2 }, { label: '08/06', value: 5 }]} color="#6366f1" />)
    expect(out).toContain('<polyline')
    expect(out).toContain('<path')
    expect(out).toContain('vector-effect="non-scaling-stroke"')
    expect(out).toContain('01/06')
    expect(out).toContain('08/06')
  })
  it('returns nothing with no points', () => {
    expect(renderToStaticMarkup(<AreaTrend points={[]} color="#000" />)).toBe('')
  })
})

describe('Legend', () => {
  it('lists label + value rows', () => {
    const out = renderToStaticMarkup(<Legend items={data} />)
    expect(out).toContain('A')
    expect(out).toContain('>3<')
    expect(out).toContain('background-color:#00ff00')
  })

  // Money is stored in cents, so a raw datum would read "543895".
  it('formats values through formatValue when given one', () => {
    const out = renderToStaticMarkup(<Legend items={data} formatValue={v => `R$ ${v},00`} />)
    expect(out).toContain('R$ 3,00')
    expect(out).not.toContain('>3<')
  })
})
