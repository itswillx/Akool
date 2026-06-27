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
`npm install` (inclui as devDependencies que o `vite build` precisa) e define
`NIXPACKS_SPA_OUTPUT_DIR=dist` para o Caddy servir o build com fallback SPA
(deep-links e refresh em rotas internas não retornam 404).

> Por que `npm install` e não `npm ci`? Em build Linux o `npm ci` pode falhar por
> `optionalDependencies` nativas (rollup/esbuild) quando o `package-lock.json` foi
> gerado em outro SO. `npm install` resolve isso sozinho.

## 2. Variáveis no Coolify (Build Time = ON)

As variáveis `VITE_*` são **embutidas no bundle em tempo de build**, então precisam
estar marcadas como *Build Time* / *Build Variable* no painel.

```env
VITE_SUPABASE_URL=https://nhfftophadasiezrzlsv.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key do Supabase Dashboard → Settings → API>
```

Opcional (quando o Google OAuth estiver ativo no frontend):

```env
VITE_GOOGLE_CLIENT_ID=<client-id>.apps.googleusercontent.com
```

> `NIXPACKS_NODE_VERSION` e `NIXPACKS_SPA_OUTPUT_DIR` já vêm do `nixpacks.toml`;
> só defina no painel se quiser sobrescrever.

## 3. Pós-deploy — Supabase

Substitua `https://SUA-URL-COOLIFY` pela URL final (domínio) do recurso no Coolify.

### 3.1 Edge Functions → Secrets

O CORS das functions (`ai-chat`, `analyze-transaction-photo`, `site-backup`) é
controlado por `ALLOWED_ORIGINS`. **Sem a URL do Coolify aqui, as chamadas de API
do app são bloqueadas por CORS.**

```env
ALLOWED_ORIGINS=https://SUA-URL-COOLIFY,https://akool.netlify.app,http://localhost:5173
```

Secrets já usadas pelas functions (configure se ainda não existirem):

```env
BACKUP_CRON_SECRET=<string aleatória longa>
GOOGLE_CLIENT_ID=<client-id>
GOOGLE_CLIENT_SECRET=<client-secret>
```

### 3.2 Authentication → URL Configuration

| Campo | Valor |
|---|---|
| Site URL | `https://SUA-URL-COOLIFY` |
| Redirect URLs | `https://SUA-URL-COOLIFY/**` |

Manter entradas de localhost se usar dev local:

```
http://localhost:5173/**
```

## 4. Checklist de validação

- [ ] `npm run build` passa localmente (gera `dist/`)
- [ ] Login/signup funciona na URL do Coolify
- [ ] Refresh em rota interna **não** retorna 404 (fallback SPA OK)
- [ ] Backup admin (`site-backup`) sem erro CORS
- [ ] Google Calendar OAuth (se usado) com redirect na URL do Coolify

## 5. Manutenção / novos deploys

- **Deploy contínuo:** com o repositório conectado, cada `git push` na branch
  configurada dispara um novo build automático no Coolify.
- **Mudar versão do Node:** edite `NIXPACKS_NODE_VERSION` no [`nixpacks.toml`](../nixpacks.toml)
  (e o [`.nvmrc`](../.nvmrc) para alinhar o ambiente local).
- **Novas variáveis `VITE_*`:** adicione no painel do Coolify como *Build Time* e
  documente em [`.env.example`](../.env.example).
- **Rollback:** o Coolify mantém histórico de deploys — use "Redeploy" de um build
  anterior pelo painel.
- **Netlify continua como fallback:** `netlify.toml` e `public/_redirects` seguem no
  repo; nenhum dos dois interfere no build do Coolify.
