# Deploy no Coolify (Nixpacks)

Aplicação **Vite/React (SPA)** — build estático servido pelo Caddy do Nixpacks.
Back-end fica no **Supabase** (auth + Edge Functions), independente do host do frontend.

## 1. Configuração do recurso no Coolify

| Campo | Valor |
|---|---|
| Build Pack | **Nixpacks** |
| Base Directory | `/` (raiz do repo) |
| Install / Build Command | deixar **vazio** — o [`nixpacks.toml`](../nixpacks.toml) controla |
| Publish / Output Directory | `dist` |
| Static Site / SPA | habilitar se o painel oferecer |

O [`nixpacks.toml`](../nixpacks.toml) fixa **Node 22**, instala dependências com
`npm ci` (inclui as devDependencies que o `vite build` precisa) e define
`NIXPACKS_SPA_OUTPUT_DIR=dist` para o Caddy servir o build com fallback SPA
(deep-links e refresh em rotas internas não retornam 404).

> **`npm ci` (DEV-004):** instala exatamente o `package-lock.json`. O lock traz as
> bindings nativas de Linux x64 e arm64 (rolldown, lightningcss, Tailwind), então
> não importa em que SO ele foi gerado. Se o lock sair de sincronia com o
> `package.json`, o `npm ci` falha: rode `npm install` localmente e publique o lock.
>
> **Versão do Node:** o `package.json` exige `^22.13.0 || >=24` (`engines`), e o
> `.npmrc` liga `engine-strict`. Se o Node 22 do Nixpacks for mais antigo, a
> instalação para com `EBADENGINE` / "Unsupported engine", dizendo a versão
> exigida e a encontrada.

## 2. Variáveis no Coolify (Build Time = ON)

As variáveis `VITE_*` são **embutidas no bundle em tempo de build**, então precisam
estar marcadas como *Build Time* / *Build Variable* no painel.

```env
VITE_SUPABASE_URL=https://nhfftophadasiezrzlsv.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key do Supabase Dashboard → Settings → API>
```

> `NIXPACKS_NODE_VERSION` e `NIXPACKS_SPA_OUTPUT_DIR` já vêm do `nixpacks.toml`;
> só defina no painel se quiser sobrescrever.

## 3. Pós-deploy — Supabase

Substitua `https://SUA-URL-COOLIFY` pela URL final (domínio) do recurso no Coolify.

### 3.1 Edge Functions → Secrets

Functions ativas no projeto, todas com fonte em `supabase/functions/`: `admin-ops`,
`cards-api` e `site-backup`. As de IA (`ai-chat`, `analyze-transaction-photo`,
`categorize-transactions` e `study-lookup`) saíram em 01/10/2026 (SEC-015): nenhuma
tela as chamava, e a chave de IA guardada em `profile_secrets` foi apagada.

> `google-calendar` foi **aposentada em 2026-08-12 (SEC-009)**. A tabela
> `user_google_tokens` que ela lia/gravava nunca chegou a ser provisionada no
> remoto, então toda ação da function falhava, e nenhum arquivo em `src/` a
> chamava. Ficava de pé só uma superfície pública quebrada com
> `Access-Control-Allow-Origin: *`. Se o Google Calendar voltar à pauta, os
> tokens OAuth nascem cifrados em repouso — não repita o desenho anterior, que
> os gravava em texto puro.
>
> **Pendente:** o fonte já saiu do repo, mas o deploy ainda está no ar. Para
> concluir: `npx supabase functions delete google-calendar --project-ref nhfftophadasiezrzlsv`.
> Enquanto isso não rodar, a function segue listada no dashboard sem fonte
> correspondente aqui: é a única nessa situação.

O CORS das functions chamadas pelo navegador vem de
`supabase/functions/_shared/cors.ts` (SEC-007). Sem `ALLOWED_ORIGINS`, só o
domínio de produção é aceito (`https://www.slinkysalsichinha.com.br`). **Se o
app roda em outra URL (ex.: a do Coolify), defina o secret com todas as origens
de produção:**

```env
ALLOWED_ORIGINS=https://SUA-URL-COOLIFY,https://www.slinkysalsichinha.com.br
```

> `https://akool.netlify.app` **não** deve estar no secret: o site na Netlify foi
> desativado (responde "site not found"), e o nome pode ser registrado por
> outra pessoa, que passaria a ser uma origem aceita (REL-005, 26/09/2026).

Localhost só em desenvolvimento (no `.env` do `supabase functions serve`), nunca
no secret de produção.

Secrets que as functions leem (`Deno.env.get`); configure se ainda não existirem:

```env
ALLOWED_ORIGINS=https://www.slinkysalsichinha.com.br   # CORS (acima)
BACKUP_CRON_SECRET=<string aleatória longa>            # site-backup, disparo automático
SENTRY_DSN=                                             # opcional, seção 7
SENTRY_RELEASE=                                         # opcional, seção 7
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` o Supabase
injeta sozinho. A lista completa, com os valores locais, está em
[`supabase/functions/.env.example`](../supabase/functions/.env.example).

`GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` podem ser **removidas** dos secrets
do projeto: nada mais as lê depois da aposentadoria da `google-calendar`.

### 3.2 Authentication → URL Configuration

| Campo | Valor |
|---|---|
| Site URL | `https://SUA-URL-COOLIFY` |
| Redirect URLs | `https://SUA-URL-COOLIFY/**` |

Manter entradas de localhost se usar dev local:

```
http://localhost:5173/**
```

### 3.3 Passkey de login no lugar do código ("Entrar com o celular")

Quem tem o app autenticador pode cadastrar uma passkey em Configurações →
Segurança. Na tela do código (depois de e-mail e senha), "Entrar com o celular"
abre a passkey: no computador o navegador mostra um QR para ler com a câmera do
celular (Bluetooth ligado nos dois aparelhos); no celular, Face ID ou digital. O
código continua valendo.

É a **passkey de login** do Supabase (experimental, `signInWithPasskey`). Em
04/10/2026 o projeto hospedado recusou a passkey como *fator de MFA* (422
"Enabling of MFA with WebAuthn not currently supported"), então o app e as edge
functions (`supabase/functions/_shared/aal.ts`) aceitam a sessão aberta com
passkey (amr `passkey`, AAL1) no lugar do código. Segurança:

- O GoTrue só deixa cadastrar passkey em sessão AAL2 de quem tem MFA: ninguém
  adiciona uma passkey só com a senha.
- A passkey do celular (Senhas do iCloud, Google) sempre pede biometria ou a
  senha do aparelho. O servidor pede verificação como "preferred": uma chave
  física sem PIN, cadastrada por quem já passou pelo MFA, entraria sem biometria.
- A sessão aberta por passkey é AAL1 no Supabase: para mudar aparelhos ou
  passkeys nela, o app pede entrar com o código.

Ligado no Supabase em 04/10/2026 (Management API `PATCH /v1/projects/{ref}/config/auth`
ou painel em Authentication → Passkeys):

| Campo | Valor |
|---|---|
| `passkey_enabled` | `true` |
| `webauthn_rp_id` | domínio do site sem `www` (ex.: `slinkysalsichinha.com.br`) |
| `webauthn_rp_display_name` | `Akool` |
| `webauthn_rp_origins` | `https://SUA-URL-COOLIFY` (até 5 origens) |

No app, a passkey só aparece com a Build Variable `VITE_MFA_PASSKEY=true` no
Coolify (novo build).

- O `webauthn_rp_id` é para sempre: trocar invalida todas as passkeys
  cadastradas.
- Com o RP do site, passkey não funciona em localhost nem em previews (outro
  domínio); o app mostra "só funcionam no site oficial". O staging precisa de
  RP próprio (ex.: `localhost` com `http://localhost:5173`).
- Para desligar sem travar ninguém: tire `VITE_MFA_PASSKEY` (o botão some) e/ou
  ponha `passkey_enabled=false`. O código continua valendo o tempo todo.

## 4. Checklist de validação

- [ ] `npm run build` passa localmente (gera `dist/`)
- [ ] Login/signup funciona na URL do Coolify
- [ ] Refresh em rota interna **não** retorna 404 (fallback SPA OK)
- [ ] Asset que não existe responde 404: `curl -I https://SEU-DOMINIO/assets/nao-existe.js`
- [ ] `index.html` com `Cache-Control: no-cache`; asset em `/assets/` com
  `immutable`; `X-Frame-Options: DENY` e `X-Content-Type-Options: nosniff` em tudo
- [ ] Backup admin (`site-backup`) sem erro CORS
- [ ] Configurações → Segurança → "Adicionar passkey" funciona, e o login aceita "Entrar com o celular" (§3.3)

## 5. Manutenção / novos deploys

- **Deploy contínuo:** com o repositório conectado, cada `git push` na branch
  configurada dispara um novo build automático no Coolify.
- **Mudar versão do Node:** edite `NIXPACKS_NODE_VERSION` no [`nixpacks.toml`](../nixpacks.toml)
  (e o [`.nvmrc`](../.nvmrc) para alinhar o ambiente local).
- **Novas variáveis `VITE_*`:** adicione no painel do Coolify como *Build Time* e
  documente em [`.env.example`](../.env.example).
- **Rollback:** o Coolify mantém histórico de deploys — use "Redeploy" de um build
  anterior pelo painel.
- **Netlify desativada:** o site `akool.netlify.app` não existe mais, e o
  `netlify.toml` e o `public/_redirects` saíram do repo em 26/09/2026 (REL-005).
  Os headers de segurança que só existiam lá foram para o Caddyfile. A CSP
  ficou para o SEC-011, porque ligá-la sem teste pode quebrar o app; a que
  estava no `netlify.toml`, como ponto de partida:
  `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src * data: blob:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'self';`

## 5.1 Preview por PR (DEV-009)

Cada pull request pode ganhar um site próprio, publicado pelo Coolify e apontando
para o **staging** (nunca para a produção). O repositório não controla isso; é
configuração do recurso no painel:

1. **Fonte como GitHub App:** em *Sources*, o recurso precisa estar ligado ao
   repositório por um GitHub App do Coolify (uma deploy key não recebe eventos
   de pull request).
2. **Preview Deployments:** no recurso, aba *Preview Deployments* → ligar. Em
   *Preview URL Template*, usar algo como `pr-{{pr_id}}.preview.<seu-domínio>`
   (o DNS do subdomínio curinga tem de apontar para o servidor do Coolify).
3. **Variáveis do preview:** em *Environment Variables*, marcar as variáveis
   como disponíveis para previews e, nelas, apontar para o staging
   (`ixqpkmxmgftchgwbrogw`), com *Build Time* ligado:

   ```env
   VITE_SUPABASE_URL=https://ixqpkmxmgftchgwbrogw.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon-key do staging>
   VITE_SENTRY_DSN=
   ```

   O staging precisa estar montado (`npm run staging:reset`, DEV-002) e com o
   usuário de teste criado. **Preview contra a produção é proibido**: os scripts
   do repo recusam o ref de produção, mas o Coolify não sabe disso — confira as
   variáveis antes de ligar.
4. **Link no PR:** o workflow [`preview-link.yml`](../.github/workflows/preview-link.yml)
   comenta a URL quando o PR abre, lendo a variável de repositório
   `PREVIEW_URL_TEMPLATE` (GitHub → Settings → Secrets and variables → Actions →
   Variables), por exemplo `https://pr-{number}.preview.<seu-domínio>`. Sem a
   variável, ele só avisa no log.

Quando o PR fecha, o Coolify apaga o preview.

## 6. Caddy: cache, 404 de assets e headers

O Nixpacks serve o `dist/` com um Caddyfile próprio (Caddy 2.8.4). O
[`nixpacks.toml`](../nixpacks.toml) o substitui pela seção `[staticAssets]`,
mesclada por último no plano do Nixpacks. Em relação ao padrão, a versão do
repo muda três coisas (REL-005):

- **`/assets/*` sem fallback de SPA:** um chunk que não existe responde 404, e
  não o `index.html` com status 200. Depois de um deploy, a aba antiga falha
  limpo no `import()`, e o app recarrega na versão nova (`src/lib/chunkReload.ts`).
- **Cache:** `public, max-age=31536000, immutable` só em asset que existe (o
  nome tem hash) e `no-cache` no `index.html` e nas rotas.
- **Headers de segurança:** `X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy` e `Permissions-Policy`.

### 6.1 CSP, HSTS e fontes do Excalidraw (SEC-009)

- **HSTS:** `Strict-Transport-Security: max-age=31536000`. O TLS termina no
  proxy do Coolify, e o header passa por ele.
- **CSP em Report-Only:** a política vai em `Content-Security-Policy-Report-Only`,
  que só avisa e não bloqueia nada.
  - **Onde ver:** as violações aparecem no console do navegador como
    "[Report Only] Refused to …".
  - **Depois de conferidas as telas logadas** (notas, desenho, financeiro), o
    header troca de nome para `Content-Security-Policy` e passa a bloquear.
  - **O que ela permite:**
    - `script-src 'self'`, sem inline e sem eval (o `index.html` não tem mais
      script inline);
    - imagens https de qualquer site;
    - conexões só com o próprio app, o Supabase do projeto (https e wss) e o
      Sentry;
    - iframes do YouTube, do Vimeo e do Figma.
  - **O host do Supabase está escrito na política.** Se o projeto mudar, a CSP
    muda junto.
- **Fontes do Excalidraw:** saem do próprio app, em
  `/excalidraw-assets/<versão>/fonts/`, e não mais do CDN `esm.sh`.
  - **Build:** o `vite.config.ts` copia as fontes do pacote para o `dist/`, e o
    `main.tsx` aponta o Excalidraw para lá.
  - **Cache:** como a versão está no caminho, o cache é de 1 ano, e arquivo que
    não existe dá 404.

Antes de publicar uma mudança no Caddyfile, valide com o mesmo Caddy. Um
Caddyfile inválido derruba o site no deploy:

```bash
caddy validate --config Caddyfile --adapter caddyfile
```

## 7. Observabilidade (Sentry)

Erros de produção do app e das edge functions vão para o Sentry (REL-011).
**Sem as variáveis abaixo, nada muda:** o SDK nem entra no bundle, e o reporter
das functions não faz nada.

**O que sai e o que não sai:**
- **Sai:** a mensagem e o stack do erro, a versão do build, o navegador e o id da
  conta (só o id).
- **Não sai:** IP, e-mail, cookies, headers, breadcrumbs de console e tracing.
- **Scrub:** e-mails, JWTs, tokens `akool_pat_`, chaves `sk-…`, `Bearer …`,
  credenciais em URL, CPF e sequências longas de dígitos são trocados por
  marcadores antes do envio (`supabase/functions/_shared/scrub.ts`, o mesmo nos
  dois lados).

### 7.1 Coolify (Build Variables)

| Variável | Para quê |
|---|---|
| `VITE_SENTRY_DSN` | Liga o SDK no app. É público: vai no bundle. |
| `SENTRY_AUTH_TOKEN` | Opcional; secret. Sobe os source maps no build (token de organização com `project:releases`). |
| `SENTRY_ORG`, `SENTRY_PROJECT` | Junto com o token: para onde vão os mapas. |
| `SENTRY_RELEASE` | Opcional. Versão do build, se o Coolify não expuser `SOURCE_COMMIT`. |

Com token, org e projeto, o build gera os source maps, sobe para o Sentry e
**apaga os `.map` do `dist/`**, para o código-fonte não ficar público no Caddy.
Se o upload falhar, o build segue (o erro aparece no log do deploy).

### 7.2 Supabase (Edge Functions → Secrets)

```env
SENTRY_DSN=<DSN do projeto no Sentry: o mesmo do app ou um projeto só das edges>
```

Os eventos das functions chegam com as tags `function` (nome da function) e
`runtime=supabase-edge`. As falhas de backup chegam com `alert=backup_failed`.

### 7.3 Alertas sugeridos

1. **Backup falhou:** alerta de issue para evento com a tag
   `alert:backup_failed`, avisando por e-mail na hora.
2. **Pico nas edges:** alerta de métrica para número de eventos com
   `runtime:supabase-edge` acima de 10 em 1 hora.

### 7.4 Conferir

No app, como admin, abra o menu da conta (botão com o seu avatar, no canto superior
direito) e a aba **Auditoria**. A linha do Sentry deve
dizer "ativo", e **Enviar evento de teste** faz o evento aparecer no Sentry em
segundos.
