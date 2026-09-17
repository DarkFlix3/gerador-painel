# 🚀 Deploy 24/7 — Guia Rápido (Neon + Render, tudo grátis)

O código já está 100% pronto, commitado e o repositório **privado**:
`https://github.com/DarkFlix3/gerador-painel`

Faltam só **2 passos manuais** (criam contas gratuitas que só você pode criar) + a migração.

---

## Passo 1 — Banco PostgreSQL grátis no Neon (~2 min)

1. Acesse https://neon.tech → **Sign up** (pode entrar com Conta Google/GitHub)
2. Novo projeto: nome qualquer, região `São Paulo (sa-east-1)` se disponível
3. Copie a **connection string** do banco principal:
   ```
   postgresql://user:senha@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require
   ```
4. Guarde — ela será usada no Passo 2 e na migração.

## Passo 2 — Deploy no Render (~3 min)

1. Acesse https://render.com → **Sign up** com o GitHub (mesma conta que tem o repo)
2. **New → Blueprint** → escolha o repositório `DarkFlix3/gerador-painel`
3. O Render lê o `render.yaml` e cria o serviço `gerador-painel` (plano **Free**, Node 22)
4. Preencha as variáveis marcadas como **secrets**:
   - `TELEGRAM_BOT_TOKEN` → o token do seu bot (do `.env` local)
   - `RESELLER_API_KEY` → a chave do revendedor principal (do `.env` local)
   - `DATABASE_URL` → a string do Neon do Passo 1
   - `JWT_SECRET` → deixe o Render **gerar** (corrige a vulnerabilidade crítica do pentest)
5. **Apply** → deploy automático. Em ~2 min o serviço sobe.
6. A URL será `https://gerador-painel.onrender.com` (aparece no painel).

## Passo 3 — Migrar os dados (SQLite → Neon) — UMA VEZ SÓ

No seu PC, na pasta do projeto:

```powershell
# 1. Cole a string do Neon no .env (linha DATABASE_URL=)
# 2. Teste sem gravar nada:
npm run migrate -- --dry-run

# 3. Execute de verdade (copia tudo: 9 revendedores, saldos, vendas, settings):
npm run migrate
```

> ⚠️ É one-shot: o que for criado localmente DEPOIS da migração não sincroniza.
> O ideal é migrar e em seguida desligar o local.

## Passo 4 — Verificar

- API: `https://gerador-painel.onrender.com/health` → `{"status":"ok","backend":"postgres",...}`
- Bot: mande `/start` para @DarkFlixSpotify_bot → deve responder e gerar link apontando para `https://gerador-painel.onrender.com/r/XXXX`
- Painel admin: `https://gerador-painel.onrender.com/admin.html`
- Portal revendedor: `https://gerador-painel.onrender.com/revendedor.html`

## Passo 5 — Desligar o PC local (só depois do Passo 4 OK)

```powershell
.\manage_bot.ps1 stop   # encerra API + bot locais
# e feche o cloudflared (túnel)
```

> ⚠️ **Crítico:** o bot local e o da nuvem NÃO podem rodar ao mesmo tempo com o
> mesmo token (long polling → conflito 409 no Telegram). Desligue o local assim
> que a nuvem estiver respondendo.

---

## Já está pronto no código (não precisa fazer nada)

| Item | Status |
|---|---|
| `server.js` async + `RETURNING id` p/ Postgres | ✅ |
| `db.js` dual (SQLite local / PostgreSQL Neon via `DATABASE_URL`) | ✅ |
| `start.js` supervisor (API + Bot com auto-restart) | ✅ |
| `render.yaml` (Blueprint Free + Node 22 + health check) | ✅ |
| `scripts/migrate-to-pg.js` (idempotente, preserva IDs, sequences) | ✅ |
| `app_base_url` automático no Render (links do bot usam `RENDER_EXTERNAL_URL`) | ✅ |
| Keep-alive a cada 5 min (impede o free tier de dormir) | ✅ |
| Repositório privado, `.env` fora do git, sem segredos no histórico | ✅ |

## Dúvidas

- **Neon lento/indisponível?** Alternativa grátis: Supabase (https://supabase.com) — mesma string `postgresql://...`, só muda o host.
- **Quero mudar a URL pública depois:** ajuste `PUBLIC_BASE_URL` no Render — o servidor atualiza `app_base_url` sozinho na subida.