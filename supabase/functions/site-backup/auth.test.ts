import { describe, expect, it } from 'vitest'
import { cronSecretMatches, decideAuth } from './auth.ts'

describe('decideAuth (SEC-003)', () => {
  it('o segredo do cron só autoriza run_auto_backup', () => {
    expect(decideAuth('run_auto_backup', true)).toBe('cron')
  })

  it('com o segredo, restore, delete e settings são proibidos (403)', () => {
    for (const action of ['restore_backup', 'delete_backup', 'update_settings', 'create_backup', 'list_backups', 'get_overview']) {
      expect(decideAuth(action, true)).toBe('forbidden')
    }
  })

  it('sem o segredo, toda ação exige JWT de admin', () => {
    for (const action of ['run_auto_backup', 'restore_backup', 'delete_backup', 'update_settings', 'list_backups']) {
      expect(decideAuth(action, false)).toBe('require_admin')
    }
  })
})

describe('cronSecretMatches', () => {
  it('aceita só o segredo exato', async () => {
    expect(await cronSecretMatches('s3gredo-longo', 's3gredo-longo')).toBe(true)
    expect(await cronSecretMatches('s3gredo-longO', 's3gredo-longo')).toBe(false)
    expect(await cronSecretMatches('s3gredo', 's3gredo-longo')).toBe(false)
  })

  it('recusa header ausente ou segredo não configurado', async () => {
    expect(await cronSecretMatches(null, 's3gredo')).toBe(false)
    expect(await cronSecretMatches('', 's3gredo')).toBe(false)
    expect(await cronSecretMatches('s3gredo', undefined)).toBe(false)
    expect(await cronSecretMatches('', '')).toBe(false)
  })
})
