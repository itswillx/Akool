import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../i18n/LanguageContext'
import { supabase } from '../../lib/supabase'
import { resolveSignedUrl } from '../../lib/storageUrl'
import { validateUpload } from '../../lib/uploadValidation'
import { AVATAR_BUCKET } from '@/shared/ui/UserAvatar'

// ARCH-008: a foto do avatar (escolher, recortar, subir, remover) fora da aba
// de perfil. O upload do objeto e a troca da coluna andam juntos: fechar o
// modal sem salvar nunca deixa uma foto órfã no bucket.

/** Foto à espera do recorte: `revoke` marca o blob: URL de um arquivo recém-escolhido. */
export interface CropSource { url: string; revoke: boolean }

export function useAvatarUpload(onError: (text: string) => void) {
  const { user, profile, updateProfile } = useAuth()
  const { t } = useLanguage()
  const [cropSource, setCropSource] = useState<CropSource | null>(null)
  const [busy, setBusy] = useState(false)

  const replaceSource = (next: CropSource | null) => {
    setCropSource(prev => {
      if (prev?.revoke) URL.revokeObjectURL(prev.url)
      return next
    })
  }

  /** Arquivo escolhido: abre o recorte; o upload só acontece ao confirmar. */
  const pickPhoto = (file: File | null) => {
    if (!file || !file.type.startsWith('image/')) return
    replaceSource({ url: URL.createObjectURL(file), revoke: true })
  }

  /** Recortar de novo a foto já enviada (URL assinada, não é revogada). */
  const adjustPhoto = async () => {
    if (!profile?.avatar_url) return
    const url = await resolveSignedUrl(AVATAR_BUCKET, profile.avatar_url)
    replaceSource({ url, revoke: false })
  }

  const closeCrop = () => replaceSource(null)

  const uploadCropped = async (blob: Blob) => {
    if (!user) return
    setBusy(true)
    const previous = profile?.avatar_url ?? null
    // SEC-011: o JPEG do recorte passa pelas mesmas regras do bucket.
    const checked = validateUpload('avatar', new File([blob], 'avatar', { type: blob.type || 'image/jpeg' }))
    if (!checked.ok) {
      onError(t(checked.reason === 'too_large' ? 'upload_error_too_large' : 'upload_error_invalid_type'))
      setBusy(false)
      closeCrop()
      return
    }
    const path = `${user.id}/${crypto.randomUUID()}.${checked.ext}`
    const { error: upErr } = await supabase.storage.from(AVATAR_BUCKET).upload(path, checked.file, { contentType: checked.file.type })
    if (upErr) {
      onError(upErr.message)
    } else {
      const { error } = await updateProfile({ avatar_url: path })
      if (error) onError(error)
      else if (previous) await supabase.storage.from(AVATAR_BUCKET).remove([previous])
    }
    setBusy(false)
    closeCrop()
  }

  const removePhoto = async () => {
    if (!profile?.avatar_url) return
    setBusy(true)
    const { error } = await updateProfile({ avatar_url: null })
    if (error) onError(error)
    else await supabase.storage.from(AVATAR_BUCKET).remove([profile.avatar_url])
    setBusy(false)
  }

  return { cropSource, busy, pickPhoto, adjustPhoto, closeCrop, uploadCropped, removePhoto }
}
