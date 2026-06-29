import { describe, expect, it } from 'vitest'
import { formatBackupSize, mapBackupError } from './useSiteBackup'
import { getT } from '../../i18n/translations'

describe('formatBackupSize', () => {
  it('formats bytes', () => {
    expect(formatBackupSize(512)).toBe('512 B')
    expect(formatBackupSize(0)).toBe('0 B')
    expect(formatBackupSize(1023)).toBe('1023 B')
  })

  it('formats kilobytes', () => {
    expect(formatBackupSize(1024)).toBe('1.0 KB')
    expect(formatBackupSize(1536)).toBe('1.5 KB')
  })

  it('formats megabytes', () => {
    expect(formatBackupSize(1024 * 1024)).toBe('1.0 MB')
    expect(formatBackupSize(2.5 * 1024 * 1024)).toBe('2.5 MB')
  })
})

describe('mapBackupError', () => {
  const tPt = getT('pt-BR')

  it('maps Unauthorized to localized message', () => {
    const msg = mapBackupError(new Error('Unauthorized'), tPt)
    expect(msg).toBe('Sessão inválida ou expirada — faça login novamente.')
  })

  it('maps Forbidden to localized message', () => {
    const msg = mapBackupError(new Error('Forbidden'), tPt)
    expect(msg).toBe('Apenas administradores podem gerenciar backups.')
  })

  it('maps unknown errors with error variable substitution', () => {
    const msg = mapBackupError(new Error('Network timeout'), tPt)
    expect(msg).toBe('Falha na operação: Network timeout')
  })

  it('handles non-Error values', () => {
    const msg = mapBackupError('Something broke', tPt)
    expect(msg).toBe('Falha na operação: Something broke')
  })

  it('uses English translations when requested', () => {
    const tEn = getT('en')
    expect(mapBackupError(new Error('Unauthorized'), tEn)).toBe(
      'Invalid or expired session — please sign in again.',
    )
  })
})
