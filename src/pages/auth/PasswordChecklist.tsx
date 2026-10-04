import { Check, Circle } from 'lucide-react'
import type { TranslationKey } from '../../i18n/translations'
import { passwordIssues } from '../../lib/passwordPolicy'
import type { PasswordIssue } from '../../lib/passwordPolicy'
import type { Translate } from './authView'

// As quatro regras da política (SEC-004), visíveis desde o início e marcadas
// conforme a senha é digitada; vai como `hint` do <Field>, então o campo a
// descreve por aria-describedby.
const RULES: { issue: PasswordIssue; key: TranslationKey }[] = [
  { issue: 'length', key: 'pwd_rule_length' },
  { issue: 'lowercase', key: 'pwd_rule_lowercase' },
  { issue: 'uppercase', key: 'pwd_rule_uppercase' },
  { issue: 'digit', key: 'pwd_rule_digit' },
]

export function PasswordChecklist({ password, t }: { password: string; t: Translate }) {
  const issues = passwordIssues(password)
  return (
    <div style={{ marginTop: 8 }}>
      <p style={{ margin: '0 0 4px', fontSize: 12, color: 'var(--color-text-muted)' }}>{t('pwd_rules_title')}</p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 3 }}>
        {RULES.map(rule => {
          const met = password.length > 0 && !issues.includes(rule.issue)
          return (
            <li key={rule.issue} data-met={met} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: met ? 'var(--color-success-text)' : 'var(--color-text-muted)' }}>
              <span aria-hidden="true" style={{ width: 14, display: 'inline-flex', justifyContent: 'center' }}>
                {met ? <Check size={13} /> : <Circle size={7} />}
              </span>
              <span>{t(rule.key)}</span>
              <span className="sr-only">{met ? t('pwd_rule_met') : t('pwd_rule_pending')}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
