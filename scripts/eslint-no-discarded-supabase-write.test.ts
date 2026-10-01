import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'
import { noDiscardedSupabaseWrite } from './eslint-no-discarded-supabase-write.mjs'

RuleTester.describe = describe
RuleTester.it = it

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } })

const inAsync = (body: string) => `async function run() { ${body} }`

tester.run('akool/no-discarded-supabase-write', noDiscardedSupabaseWrite, {
  valid: [
    inAsync("const { error } = await supabase.from('t').update({ a: 1 }).eq('id', 1)"),
    inAsync("return await supabase.from('t').delete().eq('id', 1)"),
    inAsync("await runGuarded(() => supabase.from('t').insert({ a: 1 }))"),
    inAsync("const results = await Promise.all(list.map(id => supabase.from('t').delete().eq('id', id)))"),
    // Leitura e Storage não são escrita de tabela.
    inAsync("await supabase.from('t').select('*')"),
    inAsync("await supabase.storage.from('bucket').remove(['a'])"),
    // Sem .from() não é o cliente do banco.
    inAsync('await map.delete(key)'),
    // Tratamento explícito (fire-and-forget consciente).
    "supabase.from('page_presence').delete().eq('page_id', id).then(noop, noop)",
    inAsync("await supabase.from('t').insert({ a: 1 }).then(({ error }) => report(error))"),
  ],
  invalid: [
    { code: inAsync("await supabase.from('t').update({ a: 1 }).eq('id', 1)"), errors: [{ messageId: 'discarded', data: { method: 'update' } }] },
    { code: inAsync("await supabase.from('t').delete().eq('id', 1).select('id')"), errors: [{ messageId: 'discarded', data: { method: 'delete' } }] },
    { code: inAsync("await client.from('t').insert({ a: 1 })"), errors: [{ messageId: 'discarded', data: { method: 'insert' } }] },
    { code: inAsync("await supabase\n  .from('t')\n  .upsert({ a: 1 }, { onConflict: 'a' })"), errors: [{ messageId: 'discarded', data: { method: 'upsert' } }] },
  ],
})

// UX-008
import { buttonHasName } from './eslint-button-has-name.mjs'

const jsxTester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } } })

jsxTester.run('akool/button-has-name', buttonHasName, {
  valid: [
    '<button>Salvar</button>',
    '<button>{t("save")}</button>',
    '<button><Icon /><span>{label}</span></button>',
    '<button aria-label={t("close")}><X /></button>',
    '<button title="Fechar"><X /></button>',
    '<button aria-hidden="true" tabIndex={-1}><Chevron /></button>',
    '<button {...tabProps}><Icon /></button>',
    '<button>{open ? <span>{a}</span> : <span>{b}</span>}</button>',
  ],
  invalid: [
    { code: '<button onClick={close}><X size={12} /></button>', errors: [{ messageId: 'noName' }] },
    { code: '<button style={{ background: c }} />', errors: [{ messageId: 'noName' }] },
    { code: '<button>{open ? <ChevronDown /> : <ChevronRight />}</button>', errors: [{ messageId: 'noName' }] },
  ],
})

// UX-011
import { noLiteralJsxText } from './eslint-no-literal-jsx-text.mjs'

jsxTester.run('akool/no-literal-jsx-text', noLiteralJsxText, {
  valid: [
    '<span>{t("save")}</span>',
    '<span>Akool</span>',
    '<span>✓ 42 · %</span>',
    '<input placeholder="you@example.com" />',
    '<button title={t("close")} />',
    '<div data-testid="lista" className="row" />',
  ],
  invalid: [
    { code: '<button>Salvar</button>', errors: [{ messageId: 'literal' }] },
    { code: '<button title="Fechar" />', errors: [{ messageId: 'literal' }] },
    { code: '<input placeholder={kind === "a" ? "Ex: Aluguel" : "Ex: Salário"} />', errors: [{ messageId: 'literal' }, { messageId: 'literal' }] },
    { code: '<p>{page.title || "Untitled"}</p>', errors: [{ messageId: 'literal' }] },
  ],
})
