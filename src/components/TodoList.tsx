import { memo, useEffect, useState, useMemo } from 'react'
import { Plus, Trash2, Calendar, Flag, CheckCircle2, Circle, Filter } from 'lucide-react'
import type { Todo, TodoPriority } from '../types'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { usePages } from '../contexts/PagesContext'
import { useLanguage } from '../i18n/LanguageContext'
import { useIsMobile } from '../hooks/useIsMobile'

interface TodoListProps {
  pageId: string
  embedded?: boolean
}

const priorityColors: Record<TodoPriority, string> = {
  low: '#6b7280',
  medium: '#0ea5e9',
  high: '#ef4444',
}

type FilterMode = 'all' | 'open' | 'done'

export default function TodoList({ pageId, embedded = false }: TodoListProps) {
  const { user } = useAuth()
  const { userShareRole } = usePages()
  const { t } = useLanguage()
  const [todos, setTodos] = useState<Todo[]>([])
  const [loading, setLoading] = useState(true)
  const [newText, setNewText] = useState('')
  const [filter, setFilter] = useState<FilterMode>('all')

  const role = userShareRole(pageId)
  const readOnly = role === 'viewer'
  const isCollaborative = role !== null

  const refresh = async () => {
    const { data, error } = await supabase
      .from('todos')
      .select('*')
      .eq('page_id', pageId)
      .order('completed', { ascending: true })
      .order('sort_order', { ascending: true })
    if (error) console.error('todos refresh error:', error)
    setTodos((data as Todo[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    setLoading(true)
    refresh()
    if (!isCollaborative) return
    const channel = supabase
      .channel(`todos:${pageId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'todos', filter: `page_id=eq.${pageId}` },
        () => { refresh() }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId, isCollaborative])

  const addTodo = async () => {
    const text = newText.trim()
    if (!text || !user || readOnly) return
    setNewText('')
    const { data, error } = await supabase
      .from('todos')
      .insert({ page_id: pageId, user_id: user.id, text, sort_order: Date.now() })
      .select()
      .single()
    if (error) { console.error(error); return }
    if (data) setTodos(prev => [...prev, data as Todo])
  }

  const toggleTodo = async (todo: Todo) => {
    if (readOnly) return
    const next = !todo.completed
    setTodos(prev => prev.map(t => t.id === todo.id ? { ...t, completed: next } : t))
    await supabase.from('todos').update({ completed: next, updated_at: new Date().toISOString() }).eq('id', todo.id)
  }

  const updateTodo = async (id: string, updates: Partial<Todo>) => {
    if (readOnly) return
    setTodos(prev => prev.map(t => t.id === id ? { ...t, ...updates } as Todo : t))
    await supabase.from('todos').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id)
  }

  const deleteTodo = async (id: string) => {
    if (readOnly) return
    setTodos(prev => prev.filter(t => t.id !== id))
    await supabase.from('todos').delete().eq('id', id)
  }

  const filtered = useMemo(() => {
    if (filter === 'open') return todos.filter(t => !t.completed)
    if (filter === 'done') return todos.filter(t => t.completed)
    return todos
  }, [todos, filter])

  const stats = useMemo(() => {
    const done = todos.filter(t => t.completed).length
    return { total: todos.length, done, open: todos.length - done }
  }, [todos])

  const containerStyle: React.CSSProperties = embedded
    ? { padding: 0 }
    : { maxWidth: 760, margin: '0 auto', padding: '40px 24px 80px' }

  return (
    <div style={containerStyle}>
      {!embedded && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--color-text)' }}>{t('todo_title')}</h2>
          <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--color-text-muted)' }}>
            {t('todo_stats', { open: stats.open, done: stats.done, total: stats.total })}
          </p>
        </div>
      )}

      {/* Add row */}
      {!readOnly && (
        <form onSubmit={e => { e.preventDefault(); addTodo() }} style={{ display: 'flex', gap: 8, padding: '10px 20px', borderBottom: '1px solid var(--color-border)', flexShrink: 0, backgroundColor: 'var(--color-bg)' }}>
          <Plus size={16} color="var(--color-icon)" />
          <input
            value={newText}
            onChange={e => setNewText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addTodo() }}
            placeholder={t('todo_add_placeholder')}
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: 14, color: 'var(--color-text)', backgroundColor: 'transparent' }}
          />
          <button
            onClick={addTodo}
            disabled={!newText.trim()}
            style={{ padding: '8px 14px', borderRadius: 8, border: 'none', cursor: newText.trim() && !readOnly ? 'pointer' : 'not-allowed', backgroundColor: newText.trim() && !readOnly ? 'var(--color-btn-primary)' : 'var(--color-btn-disabled)', color: newText.trim() && !readOnly ? 'var(--color-btn-primary-text)' : 'var(--color-btn-disabled-text)', fontSize: 13, fontWeight: 600, flexShrink: 0 }}
          >
            {t('todo_add_btn')}
          </button>
        </form>
      )}

      {/* Filter */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12 }}>
        <Filter size={13} color="var(--color-icon)" />
        {(['all','open','done'] as FilterMode[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: filter === f ? 'var(--color-bg-tertiary)' : 'var(--color-bg)', color: filter === f ? 'var(--color-text)' : 'var(--color-text-muted)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
          >
            {f === 'all' ? t('todo_filter_all') : f === 'open' ? t('todo_filter_open') : t('todo_filter_done')}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{t('todo_loading')}</p>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--color-text-muted)', border: '1px dashed var(--color-border)', borderRadius: 10 }}>
          <CheckCircle2 size={28} style={{ opacity: 0.5, marginBottom: 8 }} />
          <p style={{ margin: 0, fontSize: 14 }}>
            {todos.length === 0 ? t('todo_empty_all') : t('todo_empty_filter')}
          </p>
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtered.map(todo => (
            <TodoRow
              key={todo.id}
              todo={todo}
              onToggle={() => toggleTodo(todo)}
              onUpdate={updates => updateTodo(todo.id, updates)}
              onDelete={() => deleteTodo(todo.id)}
              readOnly={readOnly}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

const TodoRow = memo(function TodoRow({ todo, onToggle, onUpdate, onDelete, readOnly = false }: {
  todo: Todo
  onToggle: () => void
  onUpdate: (updates: Partial<Todo>) => void
  onDelete: () => void
  readOnly?: boolean
}) {
  const [hov, setHov] = useState(false)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(todo.text)
  const { t } = useLanguage()
  const isMobile = useIsMobile()

  const commit = () => {
    setEditing(false)
    if (text.trim() && text !== todo.text) onUpdate({ text: text.trim() })
    else setText(todo.text)
  }

  const overdue = todo.due_date && !todo.completed && new Date(todo.due_date) < new Date(new Date().toDateString())

  const toggleEl = (
    <button
      onClick={readOnly ? undefined : onToggle}
      title={todo.completed ? t('todo_mark_open') : t('todo_mark_done')}
      style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: readOnly ? 'default' : 'pointer', backgroundColor: 'transparent', padding: 0, color: todo.completed ? 'var(--color-done)' : 'var(--color-text-muted)', flexShrink: 0 }}
    >
      {todo.completed ? <CheckCircle2 size={18} /> : <Circle size={18} />}
    </button>
  )

  const titleEl = editing ? (
    <input
      autoFocus
      value={text}
      onChange={e => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setText(todo.text); setEditing(false) } }}
      style={{ flex: 1, minWidth: 0, border: '1px solid var(--color-border)', borderRadius: 6, padding: '3px 8px', fontSize: 14, outline: 'none', color: 'var(--color-text)', backgroundColor: 'var(--color-surface)' }}
    />
  ) : (
    <span
      onDoubleClick={readOnly ? undefined : () => setEditing(true)}
      style={{ flex: 1, minWidth: 0, fontSize: 14, color: todo.completed ? 'var(--color-text-muted)' : 'var(--color-text)', textDecoration: todo.completed ? 'line-through' : 'none', cursor: 'text', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
    >
      {todo.text || t('todo_untitled')}
    </span>
  )

  const priorityEl = (
    <select
      value={todo.priority}
      onChange={readOnly ? undefined : e => onUpdate({ priority: e.target.value as TodoPriority })}
      disabled={readOnly}
      title="Priority"
      style={{ border: '1px solid var(--color-border)', borderRadius: 6, padding: isMobile ? '5px 8px' : '3px 6px', fontSize: 12, backgroundColor: 'var(--color-surface)', color: priorityColors[todo.priority], cursor: readOnly ? 'default' : 'pointer', opacity: readOnly ? 0.6 : 1, flexShrink: 0 }}
    >
      <option value="low">{t('todo_priority_low')}</option>
      <option value="medium">{t('todo_priority_medium')}</option>
      <option value="high">{t('todo_priority_high')}</option>
    </select>
  )

  const dueEl = (
    <label
      title="Due date"
      style={{ display: 'flex', alignItems: 'center', gap: 4, padding: isMobile ? '5px 8px' : '3px 6px', borderRadius: 6, border: '1px solid var(--color-border)', cursor: 'pointer', color: overdue ? 'var(--color-error)' : 'var(--color-text-muted)', fontSize: 12, backgroundColor: 'var(--color-surface)', flexShrink: 0 }}
    >
      <Calendar size={12} />
      <input
        type="date"
        value={todo.due_date ?? ''}
        onChange={readOnly ? undefined : e => onUpdate({ due_date: e.target.value || null })}
        disabled={readOnly}
        style={{ border: 'none', outline: 'none', fontSize: 12, color: 'inherit', backgroundColor: 'transparent', width: todo.due_date ? 110 : 16, cursor: 'pointer' }}
      />
      {!todo.due_date && <Flag size={10} style={{ opacity: 0 }} />}
    </label>
  )

  const deleteEl = !readOnly && (
    <button
      onClick={onDelete}
      title={t('todo_delete')}
      style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer', backgroundColor: 'transparent', color: 'var(--color-text-muted)', borderRadius: 6, padding: 0, opacity: isMobile || hov ? 1 : 0.4, flexShrink: 0 }}
    >
      <Trash2 size={14} />
    </button>
  )

  // Mobile: two-line layout so the title is never squeezed by the priority/date controls.
  if (isMobile) {
    return (
      <li
        style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {toggleEl}
          {titleEl}
          {deleteEl}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 32, flexWrap: 'wrap' }}>
          {priorityEl}
          {dueEl}
        </div>
      </li>
    )
  }

  // Desktop: single-line layout.
  return (
    <li
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: hov ? 'var(--color-bg-tertiary)' : 'var(--color-bg)', transition: 'background-color 0.1s' }}
    >
      {toggleEl}
      {titleEl}
      {priorityEl}
      {dueEl}
      {deleteEl}
    </li>
  )
})
