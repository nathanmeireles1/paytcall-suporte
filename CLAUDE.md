# Portal Paytcall Operações — CLAUDE.md

Guia obrigatório para qualquer desenvolvedor ou agente IA que trabalhe neste projeto.
**Leia tudo antes de fazer qualquer alteração.**

---

## Stack

| Camada | Tecnologia |
|---|---|
| Backend | Node.js + Express |
| Templates | EJS (não React, não Next.js) |
| Banco de dados | Supabase (PostgreSQL) |
| Autenticação | Supabase Auth customizado (tabela `user_profiles`) |
| Email | Resend SDK (`resend` npm) |
| IA (Lina) | Google Gemini 2.5 Flash via API REST |
| Deploy | Railway — auto-deploy via push no `main` do GitHub |
| Repositório | GitHub: nathanmeireles1/paytcall-suporte |
| Domínio | https://operacao.paytcall.com.br |

---

## Supabase

- **Projeto operacional** (rastreios, tickets, usuários): `mckldrujoktkhjzgdded`
- **Projeto hub** (vendas, empresas — em migração): `cclvcemrxpucpxaywopc`
- Clientes configurados em `src/config/database.js`
- Nunca usar anon key para operações admin — sempre service role key via variável de ambiente

---

## Estrutura de pastas

```
src/
  app.js              — entrada da aplicação Express
  config/
    database.js       — clientes Supabase
  middleware/
    auth.js           — requireAuth, requirePermission, loadPermissions
  routes/
    admin.js          — /admin/* (usuários, permissões, configurações, docs, IA)
    ai.js             — /api/ai/chat (Lina — Gemini)
    auth.js           — /login, /logout, /invite/:token
    dashboard.js      — /dashboard
    relatorios.js     — /relatorios/* (tickets, rastreio-log, etc.)
    tracking.js       — /rastreios, /pedido/:id, refresh
    webhook.js        — /webhook (Paytcall)
  services/
    mailer.js         — envio de email via Resend
    scheduler.js      — cron 08:00 e 14:00 BRT (atualiza rastreios via H7)
    haga7.js          — integração API H7 (rastreio por CPF)
  views/
    partials/
      sidebar.ejs     — navegação lateral (roles controlam visibilidade)
      topbar.ejs      — barra superior com notificações
      ai-chat.ejs     — widget flutuante da Lina
    login.ejs
    invite.ejs        — página de aceite de convite
    dashboard.ejs
    shipment.ejs      — página do pedido individual
    relatorios-tickets.ejs
    relatorios-rastreio-log.ejs
    admin-configuracoes.ejs  — Usuários + Permissões + Sistema (abas)
    admin-docs.ejs    — documentação do sistema
    admin-ia.ejs      — página dedicada ao agente Lina
    admin-mural.ejs   — mural de avisos
  public/
    css/global.css    — design system completo (NUNCA criar CSS inline fora do padrão)
```

---

## Roles do sistema

| Role | Descrição |
|---|---|
| `admin` | Acesso total |
| `suporte` | Vê só tickets atribuídos a si |
| `logistica` | Vê só tickets LOGISTICA atribuídos a si |
| `retencao` | Vê só tickets RETENCAO atribuídos a si |
| `usuario` | Vê todos os tickets sem restrição |
| `terceiros` | Acesso restrito às empresas (seller_ids) configuradas pelo admin |

Roles são salvos em `user_profiles.role`. Permissões por módulo em `role_permissions`.

---

## Design System — regras obrigatórias

- **Sempre** usar classes do `global.css`: `card`, `card-header`, `card-body`, `card-footer`, `btn`, `btn-primary`, `btn-secondary`, `form-input`, `form-select`, `form-label`, `badge`, `table-wrap`, `toolbar`, `pagination`
- **Nunca** criar estilos inline que dupliquem o que o design system já oferece
- Modais seguem o padrão: overlay `rgba(0,0,0,.45)` + `class="card"` + `card-header` + `card-body` + `card-footer`
- Cores via variáveis CSS: `var(--brand)`, `var(--success)`, `var(--danger)`, `var(--warning)`, `var(--info)`, `var(--text)`, `var(--text-3)`, `var(--text-4)`, `var(--border)`
- Páginas públicas (login, invite) têm design próprio — não usam `global.css`

---

## Regras de desenvolvimento

### Git — obrigatório
- **Nunca commitar direto no `main`**
- Cada feature/fix em branch separada: `feat/nome`, `fix/nome`
- PR obrigatório — revisão antes de merge no `main`
- Railway deploya automaticamente ao fazer merge no `main`
- Push no `main` = vai direto para produção em `operacao.paytcall.com.br`

### Documentação
- **Toda nova regra de negócio, role, permissão ou comportamento automático DEVE ser adicionada em `/admin/docs`**
- Este `CLAUDE.md` deve ser atualizado quando: nova rota criada, nova tabela usada, novo serviço adicionado, mudança de stack

### Qualidade
- Não adicionar features além do que foi pedido
- Não criar helpers/abstrações para uso único
- Não adicionar comentários onde a lógica é óbvia
- Testar visualmente no browser antes de declarar pronto

---

## Variáveis de ambiente (Railway)

| Variável | Descrição |
|---|---|
| `SUPABASE_URL` | URL do projeto Supabase operacional |
| `SUPABASE_SERVICE_KEY` | Service role key do Supabase operacional |
| `RESEND_API_KEY` | Chave da API Resend para envio de emails |
| `SMTP_FROM` | Remetente dos emails: `Paytcall Operações <sistema@paytcall.com.br>` |
| `APP_URL` | `https://operacao.paytcall.com.br` |
| `GEMINI_API_KEY` | Fallback da chave Gemini (também configurável via painel em portal_settings) |
| `SESSION_SECRET` | Secret para cookies de sessão |
| `ADMIN_PASS` | Senha admin de emergência |
| `WONCA_API_KEY` | Chave API H7 para consulta de rastreios por CPF |

---

## Comportamentos automáticos (Scheduler)

- Roda às **08:00 e 14:00 BRT** via `node-cron`
- Consulta todos os rastreios ativos na API H7 por CPF
- Promove pedidos da `customer_queue` para `shipments` quando código de rastreio é encontrado
- **Fecha automaticamente** tickets LOGISTICA/Envio quando movimentação é detectada
- **Fecha automaticamente** tickets de "sem rastreio" quando pedido é promovido da fila
- Cada execução é registrada em `scheduler_logs` com breakdown por status

---

## Tabelas principais do Supabase

| Tabela | Descrição |
|---|---|
| `user_profiles` | Usuários do portal (role, name, email, auth_id) |
| `user_company_access` | Empresas acessíveis por usuários terceiros |
| `role_permissions` | Matriz de permissões por role e módulo |
| `shipments` | Pedidos com rastreio ativo |
| `customer_queue` | Pedidos aguardando código de rastreio |
| `tickets` | Tickets de suporte (LOGISTICA / RETENCAO) |
| `scheduler_logs` | Histórico de execuções do scheduler |
| `portal_settings` | Configurações do sistema (gemini_api_key, mural_notices) |
| `notifications` | Notificações internas por usuário |
| `cancelamentos` | Registros de cancelamento/chargeback |

---

## Fluxo de convite de usuário

1. Admin cria usuário **com senha** → ativo imediatamente via `db.auth.admin.createUser()`
2. Admin cria usuário **sem senha** → token gerado, email enviado via Resend, link expira em 7 dias
3. Admin pode reenviar convite (renova token + reenvia email)
4. Admin pode excluir apenas usuários **pendentes** (sem `auth_id`)
5. Admin pode alterar senha de usuários ativos via `db.auth.admin.updateUserById()`

---

*Atualizado em: 2026-03-30*
*Próxima atualização necessária quando: migração do hub de vendas for concluída*
