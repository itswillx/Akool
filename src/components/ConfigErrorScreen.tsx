import { getT } from '../i18n/translations'
import type { Lang } from '../i18n/translations'

// DEV-003: no lugar da tela branca quando o build sai sem a configuração do
// Supabase (ou com valor inválido). Mostra só os nomes das variáveis, nunca
// valores. Fica fora dos providers: não depende de login nem do Supabase.
export default function ConfigErrorScreen({ missing, lang }: { missing: readonly string[]; lang: Lang }) {
  const t = getT(lang)
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, boxSizing: 'border-box', backgroundColor: 'var(--color-bg-secondary)' }}>
      <div role="alert" style={{ maxWidth: 480, padding: 28, borderRadius: 14, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700 }}>{t('config_error_title')}</h1>
        <p style={{ margin: '0 0 12px', fontSize: 14, lineHeight: 1.55, color: 'var(--color-text-subtle)' }}>{t('config_error_body')}</p>
        <ul style={{ margin: '0 0 14px', paddingLeft: 20, fontSize: 13, lineHeight: 1.7 }}>
          {missing.map(name => <li key={name}><code>{name}</code></li>)}
        </ul>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--color-text-muted)' }}>{t('config_error_hint')}</p>
      </div>
    </div>
  )
}
