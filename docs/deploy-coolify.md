# Deploy no Coolify (Nixpacks)

## Configuração do recurso

| Campo | Valor |
|---|---|
| Build Pack | Nixpacks |
| Install Command | `npm ci` (ou deixar o `nixpacks.toml` controlar) |
| Build Command | `npm run build` |
| Publish Directory | `dist` |
| Static Site / SPA | habilitar se disponível no painel |

O [`nixpacks.toml`](../nixpacks.toml) fixa Node 20, instala dependências com `npm ci` (inclui devDependencies necessárias ao Vite) e define `NIXPACKS_SPA_OUTPUT_DIR=dist` para o Caddy servir o build com fallback SPA.

## Variáveis no Coolify (Build Time = ON)

```env
VITE_SUPABASE_URL=https://nhfftophadasiezrzlsv.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key do Supabase Dashboard → API>
NIXPACKS_NODE_VERSION=20
NIXPACKS_SPA_OUTPUT_DIR=dist
```

Opcional (quando Google OAuth estiver ativo no frontend):

```env
VITE_GOOGLE_CLIENT_ID=<client-id>.apps.googleusercontent.com
```

## Pós-deploy — Supabase

Substitua `https://SUA-URL-COOLIFY` pela URL final do recurso no Coolify.

### 1. Edge Functions → Secrets

```env
ALLOWED_ORIGINS=https://SUA-URL-COOLIFY,https://akool.netlify.app,http://localhost:5173
```

Secrets já usadas pelas functions (configure se ainda não existirem):

```env
BACKUP_CRON_SECRET=<string aleatória longa>
GOOGLE_CLIENT_ID=<client-id>
GOOGLE_CLIENT_SECRET=<client-secret>
```

### 2. Authentication → URL Configuration

| Campo | Valor |
|---|---|
| Site URL | `https://SUA-URL-COOLIFY` |
| Redirect URLs | `https://SUA-URL-COOLIFY/**` |

Manter entradas de localhost se usar dev local:

```
http://localhost:5173/**
```

## Checklist

- [ ] Login/signup funciona na URL do Coolify
- [ ] Refresh em rota interna não retorna 404
- [ ] Backup admin (`site-backup`) sem erro CORS
- [ ] Google Calendar OAuth (se usado) com redirect na URL Coolify
