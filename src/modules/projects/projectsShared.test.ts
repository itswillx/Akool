import { describe, expect, it } from 'vitest'
import type { CollisionDetection } from '@dnd-kit/core'
import { collisionDetection, queueBadgeLabel, todayStr } from './projectsShared'

// Helpers puros do módulo de projetos: data local, selo da fila e a colisão
// do arrasto (colunas só colidem com colunas).

describe('todayStr', () => {
  it('é a data local no formato YYYY-MM-DD', () => {
    const d = new Date()
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    expect(todayStr()).toBe(expected)
  })
})

describe('queueBadgeLabel', () => {
  const t = (k: string) => k

  it('na fila mostra a posição', () => {
    expect(queueBadgeLabel(t, { kind: 'queued', rank: 3 })).toBe('projects_queue_badge_queued'.replace('{rank}', '3'))
  })

  it('validar e aguardando têm rótulo próprio', () => {
    expect(queueBadgeLabel(t, { kind: 'review' })).toBe('projects_queue_badge_review')
    expect(queueBadgeLabel(t, { kind: 'waiting' })).toBe('projects_queue_badge_waiting')
  })

  it('em andamento mostra a fase, ou o genérico sem fase', () => {
    expect(queueBadgeLabel(t, { kind: 'working', phase: 'plano' })).toBe('projects_queue_phase_plano')
    expect(queueBadgeLabel(t, { kind: 'working', phase: null })).toBe('projects_queue_badge_working')
  })
})

type Args = Parameters<CollisionDetection>[0]

/** Droppable mínimo: id, tipo e retângulo. */
function droppable(id: string, type: 'column' | 'card', left: number) {
  const rect = { top: 0, left, width: 100, height: 100, right: left + 100, bottom: 100 }
  return { id, data: { current: { type } }, rect: { current: rect }, disabled: false, node: { current: null } }
}

function args(activeType: 'column' | 'card', pointer: { x: number; y: number } | null): Args {
  const containers = [droppable('col-a', 'column', 0), droppable('card-1', 'card', 0), droppable('col-b', 'column', 200)]
  const rect = { top: 0, left: 0, width: 100, height: 100, right: 100, bottom: 100 }
  return {
    active: { id: 'active', data: { current: { type: activeType } }, rect: { current: { initial: rect, translated: rect } } },
    collisionRect: rect,
    droppableRects: new Map(containers.map(c => [c.id, c.rect.current])),
    droppableContainers: containers,
    pointerCoordinates: pointer,
  } as unknown as Args
}

describe('collisionDetection', () => {
  it('arrastando uma coluna, só colide com colunas', () => {
    const ids = collisionDetection(args('column', { x: 10, y: 10 })).map(c => c.id)
    expect(ids).toContain('col-a')
    expect(ids).not.toContain('card-1')
  })

  it('arrastando um card, o card sob o ponteiro entra na colisão', () => {
    expect(collisionDetection(args('card', { x: 10, y: 10 })).map(c => c.id)).toContain('card-1')
  })

  it('sem ponteiro, cai na interseção de retângulos', () => {
    const ids = collisionDetection(args('card', null)).map(c => c.id)
    expect(ids).toEqual(expect.arrayContaining(['col-a', 'card-1']))
    expect(ids).not.toContain('col-b')
  })
})
