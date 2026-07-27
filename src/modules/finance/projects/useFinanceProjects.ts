import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import type {
  FinanceAttachment,
  FinanceProject,
  FinanceProjectExpense,
  FinanceProjectItem,
  FinanceProjectQuote,
  FinanceProjectStage,
  FinanceSupplier,
} from '../../../types'

// Data layer of the works ("Obras") submodule, following the optimistic
// state-first shape of useStudyTopics: mutate local state immediately, then
// persist via supabase.from().
//
// Reads are NOT filtered by user_id on purpose: RLS already narrows every table
// to rows the caller owns or shares through the finance workspace, so an extra
// .eq('user_id') would hide the obra from the partner who was invited to it.
//
// Rows are kept in flat arrays and filtered in the views. An obra is a few
// hundred rows at most, so indexing by parent would cost more complexity than
// it saves.

export const ATTACHMENT_BUCKET = 'project-expense-files'

type NewProject = Pick<FinanceProject,
  'name' | 'description' | 'icon' | 'color' | 'status' | 'budget_total' | 'started_on' | 'target_end_on' | 'workspace_id'>
type NewStage = Pick<FinanceProjectStage, 'project_id' | 'name' | 'icon' | 'color' | 'budget_amount' | 'sort_order'>
type NewSupplier = Pick<FinanceSupplier, 'name' | 'phone' | 'website' | 'notes'>
type NewItem = Pick<FinanceProjectItem,
  'project_id' | 'stage_id' | 'name' | 'notes' | 'quantity' | 'unit' | 'estimated_unit_price'
  | 'status' | 'priority' | 'attachments' | 'sort_order'>
type NewQuote = Pick<FinanceProjectQuote,
  'item_id' | 'supplier_id' | 'supplier_name' | 'unit_price' | 'total_price' | 'quoted_on' | 'url' | 'notes'>
type NewExpense = Pick<FinanceProjectExpense,
  'project_id' | 'stage_id' | 'item_id' | 'supplier_id' | 'account_id' | 'description' | 'amount'
  | 'date' | 'payment_method' | 'installments' | 'attachments'>

function normalizeItem(row: FinanceProjectItem): FinanceProjectItem {
  return {
    ...row,
    // numeric(14,3) can arrive as a string from PostgREST for large values.
    quantity: Number(row.quantity),
    attachments: (row.attachments ?? []) as FinanceAttachment[],
  }
}

function normalizeExpense(row: FinanceProjectExpense): FinanceProjectExpense {
  return { ...row, attachments: (row.attachments ?? []) as FinanceAttachment[] }
}

// Storage has no ON DELETE CASCADE: dropping a row would leave its objects
// orphaned in the bucket, so they are removed explicitly first.
async function removeAttachmentObjects(attachments: FinanceAttachment[]) {
  const paths = attachments.map(a => a.path).filter(Boolean)
  if (paths.length === 0) return
  await supabase.storage.from(ATTACHMENT_BUCKET).remove(paths)
}

export function useFinanceProjects(userId: string | undefined, workspaceId: string | null) {
  const [projects, setProjects] = useState<FinanceProject[]>([])
  const [stages, setStages] = useState<FinanceProjectStage[]>([])
  const [suppliers, setSuppliers] = useState<FinanceSupplier[]>([])
  const [items, setItems] = useState<FinanceProjectItem[]>([])
  const [quotes, setQuotes] = useState<FinanceProjectQuote[]>([])
  const [expenses, setExpenses] = useState<FinanceProjectExpense[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    // `loading` already starts true and state is only ever written from the
    // .then below — setting it synchronously here would cascade a render.
    Promise.all([
      supabase.from('finance_projects').select('*').order('created_at', { ascending: false }),
      supabase.from('finance_project_stages').select('*').order('sort_order', { ascending: true }),
      supabase.from('finance_suppliers').select('*').order('name', { ascending: true }),
      supabase.from('finance_project_items').select('*').order('sort_order', { ascending: true }),
      supabase.from('finance_project_quotes').select('*').order('created_at', { ascending: true }),
      supabase.from('finance_project_expenses').select('*').order('date', { ascending: false }),
    ]).then(([pr, st, su, it, qu, ex]) => {
      if (cancelled) return
      const failed = [pr, st, su, it, qu, ex].find(r => r.error)
      if (failed?.error) setError(failed.error.message)
      setProjects((pr.data as FinanceProject[]) ?? [])
      setStages((st.data as FinanceProjectStage[]) ?? [])
      setSuppliers((su.data as FinanceSupplier[]) ?? [])
      setItems(((it.data as FinanceProjectItem[]) ?? []).map(normalizeItem))
      setQuotes((qu.data as FinanceProjectQuote[]) ?? [])
      setExpenses(((ex.data as FinanceProjectExpense[]) ?? []).map(normalizeExpense))
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [userId])

  // Children inherit the workspace of their project rather than the current
  // view mode, so a row can never end up more (or less) shared than its obra.
  const workspaceOf = useCallback(
    (projectId: string) => projects.find(p => p.id === projectId)?.workspace_id ?? null,
    [projects],
  )

  const touch = () => ({ updated_at: new Date().toISOString() })

  // ─── Projects ──────────────────────────────────────────────────────────────

  // Sharing is decided per obra by the form (`form.workspace_id`), not by the
  // hook: tying it to the panel's Individual/Family view toggle made obras
  // created in Individual mode silently private — the family saw nothing.
  const createProject = useCallback(async (form: NewProject): Promise<FinanceProject | null> => {
    if (!userId) return null
    const { data, error: err } = await supabase
      .from('finance_projects')
      .insert({ ...form, user_id: userId })
      .select()
      .single()
    if (err || !data) { setError(err?.message ?? null); return null }
    const row = data as FinanceProject
    setProjects(prev => [row, ...prev])
    return row
  }, [userId])

  const updateProject = useCallback(async (id: string, patch: Partial<NewProject>) => {
    setProjects(prev => prev.map(p => (p.id === id ? { ...p, ...patch } : p)))
    const { error: err } = await supabase.from('finance_projects').update({ ...patch, ...touch() }).eq('id', id)
    if (err) setError(err.message)
  }, [])

  const deleteProject = useCallback(async (id: string) => {
    // Cascade in the database removes the children; clean their files first.
    const orphaned = [
      ...expenses.filter(e => e.project_id === id).flatMap(e => e.attachments),
      ...items.filter(i => i.project_id === id).flatMap(i => i.attachments),
    ]
    setProjects(prev => prev.filter(p => p.id !== id))
    setStages(prev => prev.filter(s => s.project_id !== id))
    setItems(prev => prev.filter(i => i.project_id !== id))
    setExpenses(prev => prev.filter(e => e.project_id !== id))
    await removeAttachmentObjects(orphaned)
    const { error: err } = await supabase.from('finance_projects').delete().eq('id', id)
    if (err) setError(err.message)
  }, [expenses, items])

  // ─── Stages ────────────────────────────────────────────────────────────────

  const createStage = useCallback(async (form: NewStage) => {
    if (!userId) return null
    const { data, error: err } = await supabase
      .from('finance_project_stages')
      .insert({ ...form, user_id: userId, workspace_id: workspaceOf(form.project_id) })
      .select()
      .single()
    if (err || !data) { setError(err?.message ?? null); return null }
    const row = data as FinanceProjectStage
    setStages(prev => [...prev, row])
    return row
  }, [userId, workspaceOf])

  const updateStage = useCallback(async (id: string, patch: Partial<NewStage>) => {
    setStages(prev => prev.map(s => (s.id === id ? { ...s, ...patch } : s)))
    const { error: err } = await supabase.from('finance_project_stages').update({ ...patch, ...touch() }).eq('id', id)
    if (err) setError(err.message)
  }, [])

  // Items and expenses keep their history; the FK is ON DELETE SET NULL, so the
  // local state has to mirror that or the UI would still point at a dead stage.
  const deleteStage = useCallback(async (id: string) => {
    setStages(prev => prev.filter(s => s.id !== id))
    setItems(prev => prev.map(i => (i.stage_id === id ? { ...i, stage_id: null } : i)))
    setExpenses(prev => prev.map(e => (e.stage_id === id ? { ...e, stage_id: null } : e)))
    const { error: err } = await supabase.from('finance_project_stages').delete().eq('id', id)
    if (err) setError(err.message)
  }, [])

  // ─── Suppliers ─────────────────────────────────────────────────────────────

  const createSupplier = useCallback(async (form: NewSupplier) => {
    if (!userId) return null
    const { data, error: err } = await supabase
      .from('finance_suppliers')
      .insert({ ...form, user_id: userId, workspace_id: workspaceId })
      .select()
      .single()
    if (err || !data) { setError(err?.message ?? null); return null }
    const row = data as FinanceSupplier
    setSuppliers(prev => [...prev, row].sort((a, b) => a.name.localeCompare(b.name)))
    return row
  }, [userId, workspaceId])

  const updateSupplier = useCallback(async (id: string, patch: Partial<NewSupplier>) => {
    setSuppliers(prev => prev.map(s => (s.id === id ? { ...s, ...patch } : s)))
    const { error: err } = await supabase.from('finance_suppliers').update({ ...patch, ...touch() }).eq('id', id)
    if (err) setError(err.message)
  }, [])

  const deleteSupplier = useCallback(async (id: string) => {
    setSuppliers(prev => prev.filter(s => s.id !== id))
    setExpenses(prev => prev.map(e => (e.supplier_id === id ? { ...e, supplier_id: null } : e)))
    setQuotes(prev => prev.map(q => (q.supplier_id === id ? { ...q, supplier_id: null } : q)))
    const { error: err } = await supabase.from('finance_suppliers').delete().eq('id', id)
    if (err) setError(err.message)
  }, [])

  // ─── Items ─────────────────────────────────────────────────────────────────

  const createItem = useCallback(async (form: NewItem) => {
    if (!userId) return null
    const { data, error: err } = await supabase
      .from('finance_project_items')
      .insert({ ...form, user_id: userId, workspace_id: workspaceOf(form.project_id) })
      .select()
      .single()
    if (err || !data) { setError(err?.message ?? null); return null }
    const row = normalizeItem(data as FinanceProjectItem)
    setItems(prev => [...prev, row])
    return row
  }, [userId, workspaceOf])

  const updateItem = useCallback(async (
    id: string,
    patch: Partial<NewItem & Pick<FinanceProjectItem, 'chosen_quote_id'>>,
  ) => {
    setItems(prev => prev.map(i => (i.id === id ? { ...i, ...patch } : i)))
    const { error: err } = await supabase.from('finance_project_items').update({ ...patch, ...touch() }).eq('id', id)
    if (err) setError(err.message)
  }, [])

  const deleteItem = useCallback(async (id: string) => {
    const target = items.find(i => i.id === id)
    setItems(prev => prev.filter(i => i.id !== id))
    setQuotes(prev => prev.filter(q => q.item_id !== id))
    setExpenses(prev => prev.map(e => (e.item_id === id ? { ...e, item_id: null } : e)))
    if (target) await removeAttachmentObjects(target.attachments)
    const { error: err } = await supabase.from('finance_project_items').delete().eq('id', id)
    if (err) setError(err.message)
  }, [items])

  // ─── Quotes ────────────────────────────────────────────────────────────────

  const createQuote = useCallback(async (projectId: string, form: NewQuote) => {
    if (!userId) return null
    const { data, error: err } = await supabase
      .from('finance_project_quotes')
      .insert({ ...form, user_id: userId, workspace_id: workspaceOf(projectId) })
      .select()
      .single()
    if (err || !data) { setError(err?.message ?? null); return null }
    const row = data as FinanceProjectQuote
    setQuotes(prev => [...prev, row])
    // Getting a first price moves the item out of "planned".
    setItems(prev => prev.map(i => (i.id === form.item_id && i.status === 'planned' ? { ...i, status: 'quoted' } : i)))
    const target = items.find(i => i.id === form.item_id)
    if (target?.status === 'planned') {
      await supabase.from('finance_project_items').update({ status: 'quoted', ...touch() }).eq('id', form.item_id)
    }
    return row
  }, [userId, workspaceOf, items])

  const updateQuote = useCallback(async (id: string, patch: Partial<NewQuote>) => {
    setQuotes(prev => prev.map(q => (q.id === id ? { ...q, ...patch } : q)))
    const { error: err } = await supabase.from('finance_project_quotes').update({ ...patch, ...touch() }).eq('id', id)
    if (err) setError(err.message)
  }, [])

  const deleteQuote = useCallback(async (id: string) => {
    setQuotes(prev => prev.filter(q => q.id !== id))
    setItems(prev => prev.map(i => (i.chosen_quote_id === id ? { ...i, chosen_quote_id: null } : i)))
    const { error: err } = await supabase.from('finance_project_quotes').delete().eq('id', id)
    if (err) setError(err.message)
  }, [])

  const chooseQuote = useCallback(async (itemId: string, quoteId: string | null) => {
    await updateItem(itemId, { chosen_quote_id: quoteId })
  }, [updateItem])

  // ─── Expenses ──────────────────────────────────────────────────────────────

  const createExpense = useCallback(async (form: NewExpense) => {
    if (!userId) return null
    const { data, error: err } = await supabase
      .from('finance_project_expenses')
      .insert({ ...form, user_id: userId, workspace_id: workspaceOf(form.project_id) })
      .select()
      .single()
    if (err || !data) { setError(err?.message ?? null); return null }
    const row = normalizeExpense(data as FinanceProjectExpense)
    setExpenses(prev => [row, ...prev])
    // Buying against a planned item closes it out.
    if (form.item_id) {
      setItems(prev => prev.map(i => (i.id === form.item_id ? { ...i, status: 'purchased' } : i)))
      await supabase.from('finance_project_items').update({ status: 'purchased', ...touch() }).eq('id', form.item_id)
    }
    return row
  }, [userId, workspaceOf])

  const updateExpense = useCallback(async (id: string, patch: Partial<NewExpense>) => {
    setExpenses(prev => prev.map(e => (e.id === id ? { ...e, ...patch } : e)))
    const { error: err } = await supabase.from('finance_project_expenses').update({ ...patch, ...touch() }).eq('id', id)
    if (err) setError(err.message)
  }, [])

  const deleteExpense = useCallback(async (id: string) => {
    const target = expenses.find(e => e.id === id)
    setExpenses(prev => prev.filter(e => e.id !== id))
    if (target) await removeAttachmentObjects(target.attachments)
    const { error: err } = await supabase.from('finance_project_expenses').delete().eq('id', id)
    if (err) setError(err.message)
  }, [expenses])

  return {
    projects, stages, suppliers, items, quotes, expenses, loading, error,
    createProject, updateProject, deleteProject,
    createStage, updateStage, deleteStage,
    createSupplier, updateSupplier, deleteSupplier,
    createItem, updateItem, deleteItem,
    createQuote, updateQuote, deleteQuote, chooseQuote,
    createExpense, updateExpense, deleteExpense,
  }
}

export type FinanceProjectsStore = ReturnType<typeof useFinanceProjects>
