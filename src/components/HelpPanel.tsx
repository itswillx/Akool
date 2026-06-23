import { useMemo, useState } from 'react'
import {
  Search, PlayCircle, ExternalLink, Keyboard, X,
  FilePlus2, Square, Circle, ArrowUpRight, Type, MousePointer2,
  Eye, Pencil, Crown, Calendar, Flag, FileDown,
} from 'lucide-react'
import { useLanguage } from '../i18n/LanguageContext'
import { useOnboarding } from '../contexts/OnboardingContext'
import { helpContent } from '../i18n/helpContent'
import type { HelpArticle, HelpCategory, HelpMock } from '../i18n/helpContent'
import { HelpGlyph } from './helpIcons'

function ShortcutChip({ label }: { label: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 6,
      fontSize: 11, fontWeight: 600, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      color: 'var(--color-text)', backgroundColor: 'var(--color-bg-tertiary)',
      border: '1px solid var(--color-border)', whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  )
}

function MockVisual({ name, color }: { name: HelpMock; color: string }) {
  const box: React.CSSProperties = {
    marginTop: 14, padding: 12, borderRadius: 12, border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-bg-tertiary)',
  }
  const row: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 8,
    backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)',
    fontSize: 12, color: 'var(--color-text)',
  }
  const chipBtn = (bg: string, c: string): React.CSSProperties => ({
    width: 28, height: 28, borderRadius: 7, display: 'flex', alignItems: 'center',
    justifyContent: 'center', backgroundColor: bg, color: c,
  })

  switch (name) {
    case 'sidebarCreate':
      return (
        <div style={box}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              { i: <FilePlus2 size={14} />, t: 'Nova nota / New note' },
              { i: <Pencil size={14} />, t: 'Novo desenho / New drawing' },
              { i: <FileDown size={14} />, t: 'Nota + desenho' },
              { i: <Square size={14} />, t: 'Lista de tarefas / To-do' },
            ].map((it, i) => (
              <div key={i} style={row}><span style={{ color }}>{it.i}</span>{it.t}</div>
            ))}
          </div>
        </div>
      )
    case 'slashMenu':
      return (
        <div style={box}>
          <div style={{ ...row, marginBottom: 6, color: 'var(--color-text-muted)' }}>
            <span style={{ color, fontWeight: 700 }}>/</span> heading, list, code, image...
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {['# Heading', '• List', '☑ To-do', '</> Code'].map((t) => (
              <span key={t} style={{ ...row, padding: '5px 9px' }}>{t}</span>
            ))}
          </div>
        </div>
      )
    case 'excalidrawToolbar':
      return (
        <div style={box}>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <span style={chipBtn(`${color}1f`, color)}><MousePointer2 size={15} /></span>
            <span style={chipBtn('var(--color-surface)', 'var(--color-text)')}><Square size={15} /></span>
            <span style={chipBtn('var(--color-surface)', 'var(--color-text)')}><Circle size={15} /></span>
            <span style={chipBtn('var(--color-surface)', 'var(--color-text)')}><ArrowUpRight size={15} /></span>
            <span style={chipBtn('var(--color-surface)', 'var(--color-text)')}><Type size={15} /></span>
          </div>
        </div>
      )
    case 'splitView':
      return (
        <div style={box}>
          <div style={{ display: 'flex', gap: 8, height: 70 }}>
            <div style={{ flex: 1, borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', padding: 8, fontSize: 11, color: 'var(--color-text-muted)' }}>
              <div style={{ height: 6, width: '70%', borderRadius: 3, background: 'var(--color-border)', marginBottom: 5 }} />
              <div style={{ height: 6, width: '90%', borderRadius: 3, background: 'var(--color-border)', marginBottom: 5 }} />
              <div style={{ height: 6, width: '50%', borderRadius: 3, background: 'var(--color-border)' }} />
            </div>
            <div style={{ width: 4, borderRadius: 4, backgroundColor: color }} />
            <div style={{ flex: 1, borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', color }}>
              <Pencil size={20} />
            </div>
          </div>
        </div>
      )
    case 'todoRow':
      return (
        <div style={box}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={row}>
              <span style={{ width: 15, height: 15, borderRadius: 4, border: `2px solid ${color}` }} />
              <span style={{ flex: 1 }}>Finalizar proposta</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#ef4444', fontSize: 11 }}><Calendar size={12} /> atrasada</span>
              <Flag size={13} style={{ color }} />
            </div>
            <div style={{ ...row, opacity: 0.6 }}>
              <span style={{ width: 15, height: 15, borderRadius: 4, backgroundColor: color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10 }}>✓</span>
              <span style={{ flex: 1, textDecoration: 'line-through' }}>Revisar design</span>
            </div>
          </div>
        </div>
      )
    case 'shareRoles':
      return (
        <div style={box}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              { i: <Eye size={13} />, t: 'Visualizador / Viewer' },
              { i: <Pencil size={13} />, t: 'Editor' },
              { i: <Crown size={13} />, t: 'Co-proprietário / Co-owner' },
            ].map((it, i) => (
              <div key={i} style={row}><span style={{ color }}>{it.i}</span>{it.t}</div>
            ))}
          </div>
        </div>
      )
    case 'kanban':
      return (
        <div style={box}>
          <div style={{ display: 'flex', gap: 8 }}>
            {['To do', 'Doing', 'Done'].map((col, ci) => (
              <div key={col} style={{ flex: 1, borderRadius: 8, padding: 7, backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 6 }}>{col}</div>
                {Array.from({ length: ci === 1 ? 2 : 1 }).map((_, i) => (
                  <div key={i} style={{ height: 18, borderRadius: 5, marginBottom: 5, backgroundColor: 'var(--color-bg-tertiary)', borderLeft: `3px solid ${color}` }} />
                ))}
              </div>
            ))}
          </div>
        </div>
      )
    case 'financeOverview':
      return (
        <div style={box}>
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { l: 'Receita / Income', v: '+', c: '#10b981' },
              { l: 'Despesa / Expense', v: '-', c: '#ef4444' },
              { l: 'Saldo / Balance', v: '=', c: color },
            ].map((it) => (
              <div key={it.l} style={{ flex: 1, borderRadius: 8, padding: 9, backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 6 }}>{it.l}</div>
                <div style={{ height: 8, width: '60%', borderRadius: 4, backgroundColor: it.c }} />
              </div>
            ))}
          </div>
        </div>
      )
    case 'pdfExport':
      return (
        <div style={box}>
          <div style={{ ...row, justifyContent: 'center', gap: 8, color }}>
            <FileDown size={16} /> <span style={{ color: 'var(--color-text)' }}>Exportar PDF / Export PDF</span>
          </div>
        </div>
      )
    default:
      return null
  }
}

function ArticleCard({ article, color, stepLabel, tipLabel }: {
  article: HelpArticle; color: string; stepLabel: string; tipLabel: string
}) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', padding: 20, borderRadius: 16,
      border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)',
    }}>
      <h4 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700, color: 'var(--color-text)' }}>
        {article.title}
      </h4>
      <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
        {article.summary}
      </p>

      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {article.steps.map((step, i) => (
          <li key={i} style={{ display: 'flex', gap: 10 }}>
            <span style={{
              flexShrink: 0, width: 22, height: 22, borderRadius: 999, fontSize: 11, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              backgroundColor: `${color}1a`, color,
            }} aria-label={`${stepLabel} ${i + 1}`}>
              {i + 1}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: 'var(--color-text)', lineHeight: 1.5 }}>{step.text}</div>
              {(step.shortcut || step.tip) && (
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                  {step.shortcut && step.shortcut.split(' ').map((s) => <ShortcutChip key={s} label={s} />)}
                  {step.tip && (
                    <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                      {tipLabel}: {step.tip}
                    </span>
                  )}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>

      {article.mock && <MockVisual name={article.mock} color={color} />}
    </div>
  )
}

function CategorySection({ category, stepLabel, tipLabel }: {
  category: HelpCategory; stepLabel: string; tipLabel: string
}) {
  return (
    <section style={{ marginBottom: 40 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 11, flexShrink: 0,
          backgroundColor: `${category.color}1a`, color: category.color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <HelpGlyph name={category.icon} size={20} />
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: 'var(--color-text)' }}>{category.label}</h2>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>{category.description}</p>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16, alignItems: 'start' }}>
        {category.articles.map((a) => (
          <ArticleCard key={a.id} article={a} color={category.color} stepLabel={stepLabel} tipLabel={tipLabel} />
        ))}
      </div>
    </section>
  )
}

export default function HelpPanel() {
  const { lang } = useLanguage()
  const { startTour } = useOnboarding()
  const c = helpContent[lang]

  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string>('all')

  const q = query.trim().toLowerCase()
  const searching = q.length > 0

  const matchedArticles = useMemo(() => {
    if (!searching) return []
    const results: { category: HelpCategory; article: HelpArticle }[] = []
    for (const category of c.categories) {
      for (const article of category.articles) {
        const haystack = [
          article.title, article.summary, article.keywords,
          ...article.steps.map((s) => s.text + ' ' + (s.tip ?? '')),
        ].join(' ').toLowerCase()
        if (haystack.includes(q)) results.push({ category, article })
      }
    }
    return results
  }, [c.categories, q, searching])

  const showShortcuts = !searching && (selected === 'all' || selected === 'shortcuts')
  const visibleCategories = searching
    ? []
    : selected === 'all'
      ? c.categories
      : c.categories.filter((cat) => cat.id === selected)

  const pillBase: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 999,
    fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
    border: '1px solid var(--color-border)', transition: 'all 0.15s',
  }
  const pill = (active: boolean): React.CSSProperties => ({
    ...pillBase,
    backgroundColor: active ? 'var(--color-primary)' : 'var(--color-surface)',
    color: active ? 'var(--color-btn-primary-text)' : 'var(--color-text)',
    borderColor: active ? 'var(--color-primary)' : 'var(--color-border)',
  })

  return (
    <div style={{ flex: 1, overflow: 'auto', backgroundColor: 'var(--color-bg-tertiary)' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px 80px' }}>

        {/* Hero */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
          flexWrap: 'wrap', marginBottom: 24,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 48, height: 48, borderRadius: 14, backgroundColor: 'var(--color-primary)',
              color: 'var(--color-btn-primary-text)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <HelpGlyph name="help" size={24} />
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: 'var(--color-text)' }}>{c.heroTitle}</h1>
              <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--color-text-muted)' }}>{c.heroSubtitle}</p>
            </div>
          </div>
          <button
            onClick={startTour}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderRadius: 12,
              border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600,
              backgroundColor: 'var(--color-primary)', color: 'var(--color-btn-primary-text)',
            }}
          >
            <PlayCircle size={17} /> {c.startTour}
          </button>
        </div>

        {/* Search */}
        <div style={{ position: 'relative', marginBottom: 18 }}>
          <Search size={17} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={c.searchPlaceholder}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '12px 40px', borderRadius: 12,
              border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)',
              color: 'var(--color-text)', fontSize: 14, outline: 'none',
            }}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label="clear"
              style={{
                position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                width: 26, height: 26, borderRadius: 7, border: 'none', cursor: 'pointer',
                background: 'transparent', color: 'var(--color-text-muted)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Category pills */}
        {!searching && (
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6, marginBottom: 26 }}>
            <button style={pill(selected === 'all')} onClick={() => setSelected('all')}>{c.allCategories}</button>
            {c.categories.map((cat) => (
              <button key={cat.id} style={pill(selected === cat.id)} onClick={() => setSelected(cat.id)}>
                <HelpGlyph name={cat.icon} size={14} /> {cat.label}
              </button>
            ))}
            <button style={pill(selected === 'shortcuts')} onClick={() => setSelected('shortcuts')}>
              <Keyboard size={14} /> {c.shortcutsTitle}
            </button>
          </div>
        )}

        {/* Search results */}
        {searching && (
          matchedArticles.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-text-muted)' }}>
              <Search size={36} style={{ opacity: 0.4, marginBottom: 12 }} />
              <h3 style={{ margin: '0 0 6px', fontSize: 16, color: 'var(--color-text)' }}>{c.searchEmptyTitle}</h3>
              <p style={{ margin: 0, fontSize: 13 }}>{c.searchEmptyDesc}</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16, alignItems: 'start' }}>
              {matchedArticles.map(({ category, article }) => (
                <ArticleCard key={category.id + article.id} article={article} color={category.color} stepLabel={c.stepLabel} tipLabel={c.tipLabel} />
              ))}
            </div>
          )
        )}

        {/* Categories */}
        {visibleCategories.map((cat) => (
          <CategorySection key={cat.id} category={cat} stepLabel={c.stepLabel} tipLabel={c.tipLabel} />
        ))}

        {/* Shortcuts */}
        {showShortcuts && (
          <section>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 11, flexShrink: 0,
                backgroundColor: 'var(--color-bg-tertiary)', color: 'var(--color-text)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--color-border)',
              }}>
                <Keyboard size={20} />
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: 'var(--color-text)' }}>{c.shortcutsTitle}</h2>
                <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>{c.shortcutsSubtitle}</p>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16, alignItems: 'start' }}>
              {c.shortcutGroups.map((group) => (
                <div key={group.title} style={{ padding: 20, borderRadius: 16, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
                  <h4 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700, color: 'var(--color-text)' }}>{group.title}</h4>
                  {group.note && <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--color-text-muted)' }}>{group.note}</p>}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                    {group.items.map((item) => (
                      <div key={item.keys + item.action} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                        <span style={{ fontSize: 13, color: 'var(--color-text)' }}>{item.action}</span>
                        <ShortcutChip label={item.keys} />
                      </div>
                    ))}
                  </div>
                  {group.docsUrl && (
                    <a
                      href={group.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 14, fontSize: 12, fontWeight: 600, color: 'var(--color-primary)', textDecoration: 'none' }}
                    >
                      {group.docsLabel} <ExternalLink size={12} />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

      </div>
    </div>
  )
}
