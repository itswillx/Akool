import type { ReactNode } from 'react'
import { MODULE_COLORS, PREVIEW_CARDS, PREVIEW_MONTHS, PREVIEW_TIMELINE_DAYS } from '../../i18n/appPreviewContent'
import type { AppPreviewContent, PreviewCardId } from '../../i18n/appPreviewContent'
import type { ProjectCardPriority } from '../../types'
import type { Lang } from '../../i18n/translations'
import { PROJECT_PRIORITY_COLORS, projectPriorityLabelKey } from '../../lib/priorities'
import type { Translate } from './authView'
import { PREVIEW_COLUMNS, PREVIEW_NAV, PREVIEW_VIEWS, barHeight, cardsIn, monthKpis, navOf, nextColumn, previewMoney, wipOf } from './previewState'
import type { AppPreviewVariant, PreviewAction, PreviewNav, PreviewState } from './previewState'

// As partes da prévia do app (AppPreview). Cada uma desenha o mesmo visual nos
// dois modos: ilustração (spans, dentro de aria-hidden + inert, no painel do
// login) e demonstração (controles nativos, na landing). As escolhas
// exclusivas (módulo, visão do quadro, mês) são grupos de rádio: uma parada de
// Tab por grupo, setas de graça; tarefas e pontos são checkboxes; o card é um
// botão que vai para a próxima coluna.

export interface PartProps {
  c: AppPreviewContent
  t: Translate
  lang: Lang
  s: PreviewState
  /** Prefixo dos ids e dos nomes dos grupos de rádio (o hero e a vitrine estão na mesma página). */
  uid: string
  /** Só na demonstração: aplica a ação e avisa quem usa a prévia. */
  act?: (action: PreviewAction) => void
  /** Só na demonstração: move o card e leva o foco junto. */
  move?: (id: PreviewCardId) => void
}

/** Rádio ou checkbox nativo (escondido; o rótulo é o visual) na demonstração; span na ilustração. */
function Choice({ live, type, name, checked, onChange, className, children }: {
  live: boolean
  type: 'radio' | 'checkbox'
  name?: string
  checked: boolean
  onChange: () => void
  className: string
  children: ReactNode
}) {
  if (!live) return <span className={className}>{children}</span>
  return (
    <label className={className}>
      <input type={type} name={name} checked={checked} onChange={onChange} className="sr-only" />
      {children}
    </label>
  )
}

function PriorityChip({ t, priority }: { t: Translate; priority: ProjectCardPriority }) {
  return <span className="pv-chip" style={{ color: PROJECT_PRIORITY_COLORS[priority] }}>{t(projectPriorityLabelKey(priority))}</span>
}

const NAV_COLORS: Record<PreviewNav, string> = {
  dashboard: MODULE_COLORS.help,
  documents: MODULE_COLORS.pages,
  projects: MODULE_COLORS.projects,
  finance: MODULE_COLORS.finance,
}

export function Sidebar({ c, uid, variant, onNav }: {
  c: AppPreviewContent
  uid: string
  variant: AppPreviewVariant
  onNav?: (nav: PreviewNav) => void
}) {
  const on = navOf(variant)
  const live = !!onNav
  return (
    <div className="pv-side">
      <span className="pv-search">{c.nav.search}</span>
      <div role={live ? 'radiogroup' : undefined} aria-label={live ? c.demo.navLabel : undefined} className="pv-side-group">
        {PREVIEW_NAV.map(nav => (
          <Choice key={nav} live={live} type="radio" name={`${uid}-nav`} checked={nav === on} onChange={() => onNav?.(nav)} className={nav === on ? 'pv-nav pv-nav-on' : 'pv-nav'}>
            <span className="pv-nav-dot" style={{ backgroundColor: NAV_COLORS[nav] }} />
            {c.nav[nav]}
          </Choice>
        ))}
      </div>
      <span className="pv-side-label">{c.nav.favorites}</span>
      {c.favorites.map(name => <span key={name} className="pv-nav pv-nav-fav">{name}</span>)}
    </div>
  )
}

function Kanban({ c, t, s, uid, move }: PartProps) {
  const live = !!move
  return (
    <div className="pv-cols">
      {c.board.columns.map((title, column) => {
        const wip = wipOf(s, column)
        const next = c.board.columns[nextColumn(column)]
        return (
          // Na demonstração a coluna é um grupo com nome (título + WIP): quando o
          // foco segue o card, o leitor de tela anuncia onde ele caiu.
          <div key={title} className="pv-col" role={live ? 'group' : undefined} aria-label={live ? (wip.limit === null ? title : `${title} ${wip.count}/${wip.limit}`) : undefined}>
            <span className="pv-col-head">
              {title}
              {wip.limit !== null && <span className={wip.over ? 'pv-wip pv-wip-over' : 'pv-wip'}>{wip.count}/{wip.limit}</span>}
            </span>
            {cardsIn(s, column).map(card => {
              const text = c.board.cards[card.id]
              const inner = (
                <>
                  <span className="pv-card-title">{text.title}</span>
                  <span className="pv-card-meta">
                    <PriorityChip t={t} priority={card.priority} />
                    <span>{text.due}</span>
                  </span>
                </>
              )
              if (!move) return <span key={card.id} className="pv-card">{inner}</span>
              return (
                <button key={card.id} type="button" id={`${uid}-card-${card.id}`} className="pv-card" onClick={() => move(card.id)}>
                  {inner}
                  <span className="sr-only">{`${c.demo.moveTo} ${next}`}</span>
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

const isDone = (s: PreviewState, id: PreviewCardId) => s.columns[id] === PREVIEW_COLUMNS - 1

function Timeline({ c, s }: PartProps) {
  return (
    <div className="pv-timeline">
      {PREVIEW_CARDS.map(card => {
        const [start, days] = card.span
        const done = isDone(s, card.id)
        return (
          <span key={card.id} className="pv-tl-row">
            <span className={done ? 'pv-tl-title pv-done' : 'pv-tl-title'}>{c.board.cards[card.id].title}</span>
            <span className="pv-tl-track">
              <span
                className={done ? 'pv-tl-bar pv-tl-bar-done' : 'pv-tl-bar'}
                style={{ left: `${(start / PREVIEW_TIMELINE_DAYS) * 100}%`, width: `${(days / PREVIEW_TIMELINE_DAYS) * 100}%`, backgroundColor: PROJECT_PRIORITY_COLORS[card.priority] }}
              />
            </span>
          </span>
        )
      })}
    </div>
  )
}

function List({ c, t, s }: PartProps) {
  return (
    <div className="pv-list">
      {PREVIEW_CARDS.map(card => {
        const text = c.board.cards[card.id]
        return (
          <span key={card.id} className="pv-list-row">
            <span className={isDone(s, card.id) ? 'pv-list-title pv-done' : 'pv-list-title'}>{text.title}</span>
            <span className="pv-muted">{c.board.columns[s.columns[card.id]]}</span>
            <PriorityChip t={t} priority={card.priority} />
            <span className="pv-muted">{text.due}</span>
          </span>
        )
      })}
    </div>
  )
}

export function Board(props: PartProps) {
  const { c, s, uid, act } = props
  const live = !!act
  return (
    <div className="pv-panel">
      <div className="pv-head">
        <strong className="pv-h">{c.board.name}</strong>
        <span role={live ? 'radiogroup' : undefined} aria-label={live ? c.demo.viewsLabel : undefined} className="pv-tabs">
          {PREVIEW_VIEWS.map((view, i) => (
            <Choice key={view} live={live} type="radio" name={`${uid}-view`} checked={s.view === view} onChange={() => act?.({ type: 'view', view })} className={s.view === view ? 'pv-tab pv-tab-on' : 'pv-tab'}>
              {c.board.views[i]}
            </Choice>
          ))}
        </span>
      </div>
      {s.view === 'kanban' ? <Kanban {...props} /> : s.view === 'timeline' ? <Timeline {...props} /> : <List {...props} />}
    </div>
  )
}

export function Finance({ c, lang, s, uid, act }: PartProps) {
  const f = c.finance
  const live = !!act
  const kpis = monthKpis(s.month)
  const tiles = [
    { label: f.income, value: kpis.income, color: 'var(--color-done)' },
    { label: f.expense, value: kpis.expense, color: 'var(--color-error)' },
    { label: f.balance, value: kpis.balance, color: 'var(--color-text)' },
  ]
  return (
    <div className="pv-panel">
      <div className="pv-head"><strong className="pv-h">{f.monthsLong[s.month]}</strong></div>
      {/* Os totais mudam com o mês escolhido: anunciados sem tirar o foco do gráfico. */}
      <div className="pv-kpis" aria-live={live ? 'polite' : undefined} aria-atomic={live ? true : undefined}>
        {tiles.map(tile => (
          <span key={tile.label} className="pv-kpi">
            <span className="pv-muted">{tile.label}</span>
            <strong style={{ color: tile.color }}>{previewMoney(lang, tile.value)}</strong>
          </span>
        ))}
      </div>
      <div className="pv-chart" role={live ? 'radiogroup' : undefined} aria-label={live ? c.demo.monthsLabel : undefined}>
        {PREVIEW_MONTHS.map(([income, expense], i) => (
          <Choice key={f.months[i]} live={live} type="radio" name={`${uid}-month`} checked={s.month === i} onChange={() => act?.({ type: 'month', index: i })} className={s.month === i ? 'pv-bars pv-bars-on' : 'pv-bars'}>
            <span className="pv-bar" style={{ height: `${barHeight(income)}%`, backgroundColor: 'var(--color-done)' }} />
            <span className="pv-bar" style={{ height: `${barHeight(expense)}%`, backgroundColor: 'var(--color-error)' }} />
            <span className="pv-month">{f.months[i]}</span>
          </Choice>
        ))}
      </div>
      <span className="pv-budget">
        <span className="pv-row"><span>{f.budget}</span><span className="pv-muted">{f.budgetValue}</span></span>
        <span className="pv-meter"><span style={{ width: '72%', backgroundColor: MODULE_COLORS.finance }} /></span>
      </span>
    </div>
  )
}

function Checks({ items, done, color, kind, act }: {
  items: readonly string[]
  done: readonly boolean[]
  color: string
  kind: 'task' | 'point'
  act?: (action: PreviewAction) => void
}) {
  return (
    <span className="pv-checks">
      {items.map((text, index) => (
        <Choice key={text} live={!!act} type="checkbox" checked={done[index]} onChange={() => act?.({ type: kind, index })} className={done[index] ? 'pv-check pv-check-done' : 'pv-check'}>
          <span className="pv-box" style={done[index] ? { backgroundColor: color, borderColor: color } : undefined} />
          {text}
        </Choice>
      ))}
    </span>
  )
}

export function Page({ c, s, act }: PartProps) {
  return (
    <div className="pv-panel">
      <strong className="pv-h pv-page-title">{c.page.title}</strong>
      <span className="pv-line" style={{ width: '94%' }} />
      <span className="pv-line" style={{ width: '72%' }} />
      <Checks items={c.page.tasks} done={s.tasks} color={MODULE_COLORS.pages} kind="task" act={act} />
      <span className="pv-drawing" style={{ color: MODULE_COLORS.pages }}>
        <svg viewBox="0 0 220 64" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="6" y="14" width="56" height="34" rx="8" />
          <path d="M66 31h40m-8-7 8 7-8 7" />
          <ellipse cx="140" cy="31" rx="28" ry="18" />
          <path d="M172 31h22m-7-6 7 6-7 6" />
          <rect x="198" y="20" width="16" height="22" rx="4" />
        </svg>
        <span className="pv-muted">{c.page.drawing}</span>
      </span>
    </div>
  )
}

export function Study({ c, s, act }: PartProps) {
  const progress = Math.round((s.points.filter(Boolean).length / s.points.length) * 100)
  return (
    <div className="pv-panel">
      <span className="pv-kicker" style={{ color: MODULE_COLORS.study }}>{c.study.step}</span>
      <strong className="pv-h">{c.study.topic}</strong>
      <span className="pv-meter"><span className="pv-progress" style={{ width: `${progress}%`, backgroundColor: MODULE_COLORS.study }} /></span>
      <Checks items={c.study.points} done={s.points} color={MODULE_COLORS.study} kind="point" act={act} />
      <span className="pv-chip pv-chip-lg" style={{ color: MODULE_COLORS.study }}>{c.study.quiz}</span>
    </div>
  )
}

export function Overview(props: PartProps) {
  const { c, lang, s } = props
  return (
    <div className="pv-overview">
      <Board {...props} />
      <span className="pv-float">
        <span className="pv-muted">{c.finance.balance}</span>
        <strong>{previewMoney(lang, monthKpis(s.month).balance)}</strong>
        <span className="pv-mini-bars">
          {PREVIEW_MONTHS.map(([income], i) => <span key={c.finance.months[i]} style={{ height: `${barHeight(income)}%`, backgroundColor: MODULE_COLORS.finance }} />)}
        </span>
      </span>
    </div>
  )
}
