# Testes E2E (TestSprite)

Scripts Playwright gerados pelo TestSprite (`TC0*.py`), mais o PRD (`standard_prd.json`) e o plano (`testsprite_frontend_test_plan.json`) usados para gerá-los.

## Credenciais só pelo ambiente (SEC-001)

Nenhum script guarda credenciais:

| Variável | Uso |
| --- | --- |
| `LOGIN_USER` / `LOGIN_PASSWORD` | login (todos, menos o TC022, que testa credenciais inválidas) |
| `TARGET_PROMOTE_EMAIL` / `TARGET_DEMOTE_EMAIL` | usuários alvo de "Promover para Admin" e "Rebaixar para Padrão" (TC019, TC025) |

Para rodar um script, com o app **do staging** servido em `http://localhost:4173` (`npm run build:staging && npm run preview:staging`, ver "Ambientes" no README) e o Playwright para Python instalado (`pip install playwright && playwright install chromium`):

```bash
LOGIN_USER=... LOGIN_PASSWORD=... python3 testsprite_tests/TC001_Sign_in_and_reach_the_dashboard.py
```

- Use um **usuário de teste**, não a conta de admin.
- A raiz (`/`, e `/login` pelo fallback do SPA) é a página pública: o formulário de login fica em `/#entrar`. Os scripts atuais esperam o campo de e-mail logo na raiz e param por timeout; ao regenerá-los, navegue para `http://localhost:4173/#entrar`. As abas Entrar / Criar conta são links: `get_by_role('button', name='Entrar', exact=True)` acha só o botão de enviar.
- **Nunca rode contra a produção.** O `build:staging` usa o `.env.staging.local` (projeto `akool-staging`). O `npm run build` comum aponta para a produção, e ali o TC019 e o TC025 alteram o papel de usuários, e o TC020 e o TC026 disparam backup (DEV-002).
- No staging, crie os usuários de teste (e os alvos de promover/rebaixar) no painel: Authentication → Add user.
- No TestSprite, as credenciais ficam só na configuração dele (`testsprite_tests/tmp/`, ignorada pelo git). O PRD e o plano usam `{{LOGIN_USER}}`/`{{LOGIN_PASSWORD}}`.

## Depois de regenerar pelo TestSprite

Os scripts novos vêm com os valores literais do login. O `npm test` falha (`scripts/testsprite-credentials.test.ts`) e aponta arquivo e linha, sem mostrar o valor. Troque os literais por `LOGIN_USER`/`LOGIN_PASSWORD` (veja qualquer `TC0*.py` atual) antes de commitar.
