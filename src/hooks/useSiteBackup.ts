import { useCallback, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { SiteBackup, SiteBackupSettings } from '../types'

const EDGE_FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/site-backup`
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

async function getAccessToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Sessão expirada — faça login novamente')
  return session.access_token
}

async function callSiteBackup(body: Record<string, unknown>) {
  const token = await getAccessToken()
  let res: Response
  try {
    res = await fetch(EDGE_FN, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: ANON_KEY,
      },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('Backend não configurado — faça deploy da Edge Function site-backup no Supabase')
  }
  let data: Record<string, unknown> = {}
  try {
    data = await res.json()
  } catch {
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  }
  if (!res.ok) throw new Error(String(data.error ?? 'Request failed'))
  return data as {
    backups?: SiteBackup[]
    settings?: SiteBackupSettings
    backup?: SiteBackup
    success?: boolean
    error?: string
  }
}

async function fetchListAndSettings(): Promise<{ backups: SiteBackup[]; settings: SiteBackupSettings | null }> {
  const [listRes, settingsRes] = await Promise.all([
    callSiteBackup({ action: 'list_backups' }),
    callSiteBackup({ action: 'get_settings' }),
  ])
  return {
    backups: listRes.backups ?? [],
    settings: settingsRes.settings ?? null,
  }
}

export function useSiteBackup(enabled: boolean) {
  const [backups, setBackups] = useState<SiteBackup[]>([])
  const [settings, setSettings] = useState<SiteBackupSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [runningAction, setRunningAction] = useState<string | null>(null)

  const runAutoBackupIfDue = useCallback(async (
    currentBackups: SiteBackup[],
    currentSettings: SiteBackupSettings | null,
  ): Promise<boolean> => {
    if (!enabled || !currentSettings?.auto_enabled) return false
    const intervalMs = (currentSettings.interval_days ?? 7) * 86400000
    const lastAuto = currentSettings.last_auto_at ? new Date(currentSettings.last_auto_at).getTime() : 0
    if (Date.now() - lastAuto < intervalMs) return false
    if (currentBackups.some(b => b.status === 'running')) return false

    setRunningAction('auto')
    try {
      await callSiteBackup({ action: 'create_backup', type: 'automatic' })
      return true
    } catch {
      // silent fallback — cron may handle it
      return false
    } finally {
      setRunningAction(null)
    }
  }, [enabled])

  const refreshList = useCallback(async (options?: { initial?: boolean; runAuto?: boolean }) => {
    if (!enabled) return
    if (options?.initial) setLoading(true)
    try {
      let { backups: nextBackups, settings: nextSettings } = await fetchListAndSettings()
      setBackups(nextBackups)
      setSettings(nextSettings)

      if (options?.runAuto) {
        const ran = await runAutoBackupIfDue(nextBackups, nextSettings)
        if (ran) {
          const updated = await fetchListAndSettings()
          nextBackups = updated.backups
          nextSettings = updated.settings
          setBackups(nextBackups)
          setSettings(nextSettings)
        }
      }
    } finally {
      if (options?.initial) setLoading(false)
    }
  }, [enabled, runAutoBackupIfDue])

  const createManualBackup = useCallback(async () => {
    if (!enabled) return
    setRunningAction('create')
    try {
      await callSiteBackup({ action: 'create_backup', type: 'manual' })
      await refreshList()
    } finally {
      setRunningAction(null)
    }
  }, [enabled, refreshList])

  const restoreBackup = useCallback(async (backupId: string) => {
    if (!enabled) return
    setRunningAction(`restore-${backupId}`)
    try {
      await callSiteBackup({ action: 'restore_backup', backup_id: backupId })
    } finally {
      setRunningAction(null)
    }
  }, [enabled])

  const deleteBackup = useCallback(async (backupId: string) => {
    if (!enabled) return
    setRunningAction(`delete-${backupId}`)
    try {
      await callSiteBackup({ action: 'delete_backup', backup_id: backupId })
      await refreshList()
    } finally {
      setRunningAction(null)
    }
  }, [enabled, refreshList])

  const toggleAutoBackup = useCallback(async (enabledFlag: boolean) => {
    if (!enabled) return
    setRunningAction('settings')
    try {
      const res = await callSiteBackup({ action: 'update_settings', auto_enabled: enabledFlag })
      setSettings(res.settings ?? null)
    } finally {
      setRunningAction(null)
    }
  }, [enabled])

  return {
    backups,
    settings,
    loading,
    runningAction,
    refreshList,
    createManualBackup,
    restoreBackup,
    deleteBackup,
    toggleAutoBackup,
  }
}

export function formatBackupSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function mapBackupError(error: unknown, t: (key: 'backup_error_unauthorized' | 'backup_error_forbidden' | 'backup_failed', vars?: Record<string, string>) => string): string {
  const msg = error instanceof Error ? error.message : String(error)
  if (msg === 'Unauthorized') return t('backup_error_unauthorized')
  if (msg === 'Forbidden') return t('backup_error_forbidden')
  return t('backup_failed', { error: msg })
}
