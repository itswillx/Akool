import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { generateInviteCode, listMyInviteCodes, profileEmailsById } from '../../lib/data/invites'

// ARCH-008: os códigos de convite da própria conta (aba Convites).

export interface InviteCode {
  id: string
  code: string
  created_at: string
  expires_at: string
  used_at: string | null
  used_by: string | null
  used_by_email?: string | null
}

/** Os meus códigos com o e-mail de quem usou; sem setState (puro). */
async function loadInvites(): Promise<InviteCode[]> {
  const { data } = await listMyInviteCodes()
  const codes: InviteCode[] = data ?? []
  const emails = await profileEmailsById(codes.flatMap(c => (c.used_by ? [c.used_by] : [])))
  return codes.map(c => (c.used_by ? { ...c, used_by_email: emails[c.used_by] ?? null } : c))
}

export function useMyInvites() {
  const { refreshProfile } = useAuth()
  const [invites, setInvites] = useState<InviteCode[]>([])
  // A aba monta com `loading` true; o efeito só aplica a resposta.
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const applyInvites = useCallback((rows: InviteCode[]) => {
    setInvites(rows)
    setLoading(false)
  }, [])
  const load = async () => applyInvites(await loadInvites())
  useEffect(() => {
    let cancelled = false
    void loadInvites().then(rows => { if (!cancelled) applyInvites(rows) })
    return () => { cancelled = true }
  }, [applyInvites])

  const generate = async () => {
    setGenerating(true)
    const { error } = await generateInviteCode()
    if (!error) {
      await load()
      await refreshProfile()
    }
    setGenerating(false)
  }

  const copy = (code: InviteCode) => {
    void navigator.clipboard.writeText(code.code)
    setCopiedId(code.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  return { invites, loading, generating, copiedId, generate, copy }
}
