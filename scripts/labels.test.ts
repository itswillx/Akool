import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// UX-007: trava para labels soltos. Um <label> sem htmlFor que não envolve o
// campo não rotula nada: o leitor de tela anuncia só "caixa de texto". Novos
// formulários usam o <Field> (src/shared/ui/Field.tsx). Os labels antigos
// estão contados por arquivo em scripts/label-baseline.json: o número não pode
// subir, e quando cair, rode `UPDATE_LABEL_BASELINE=1 npx vitest run scripts/labels.test.ts`.

const ROOT = join(__dirname, '..')
const BASELINE_PATH = join(ROOT, 'scripts/label-baseline.json')

/** Quantos <label> do código não têm htmlFor nem envolvem input/select/textarea. */
export function countLooseLabels(source: string): number {
  // `=>` dentro de um atributo encerraria a tag cedo demais na regex.
  const text = source.replace(/=>/g, '=»')
  const tag = /<label\b([^>]*)>/g
  let loose = 0
  let match: RegExpExecArray | null
  while ((match = tag.exec(text))) {
    if (/\bhtmlFor=/.test(match[1])) continue
    const close = text.indexOf('</label>', tag.lastIndex)
    const inner = close === -1 ? '' : text.slice(tag.lastIndex, close)
    if (/<(input|select|textarea)\b/.test(inner)) continue
    loose++
  }
  return loose
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return path.endsWith('.tsx') && !path.includes('.test.') ? [path] : []
  })
}

function currentCounts(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const file of sourceFiles(join(ROOT, 'src'))) {
    const n = countLooseLabels(readFileSync(file, 'utf8'))
    if (n > 0) out[relative(ROOT, file)] = n
  }
  return out
}

describe('countLooseLabels', () => {
  it('counts a label that labels nothing', () => {
    expect(countLooseLabels('<div><label style={{ a: 1 }}>Nome</label><input /></div>')).toBe(1)
  })

  it('accepts htmlFor and a label that wraps its field', () => {
    expect(countLooseLabels('<label htmlFor={id}>Nome</label><input id={id} />')).toBe(0)
    expect(countLooseLabels('<label onClick={() => go()}>Ver <input type="checkbox" /></label>')).toBe(0)
  })
})

describe('labels soltos (UX-007)', () => {
  it('nenhum arquivo piora em relação à base', () => {
    const current = currentCounts()
    if (process.env.UPDATE_LABEL_BASELINE) {
      writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + '\n')
    }
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Record<string, number>
    const worse = Object.entries(current)
      .filter(([file, n]) => n > (baseline[file] ?? 0))
      .map(([file, n]) => `${file}: ${baseline[file] ?? 0} → ${n}`)
    expect(worse, 'use o <Field> (src/shared/ui/Field.tsx) nos labels novos').toEqual([])
  })

  it('os fluxos migrados continuam sem label solto', () => {
    const current = currentCounts()
    for (const file of [
      'src/pages/AuthPage.tsx', 'src/pages/ResetPasswordPage.tsx', 'src/pages/MfaChallengePage.tsx',
      'src/components/UserSettingsModal.tsx', 'src/components/MfaSection.tsx', 'src/modules/projects/ImportCardsModal.tsx',
    ]) {
      expect(current[file] ?? 0, file).toBe(0)
    }
  })
})
