# Portal Paytcall Operações — CLAUDE.md

Guia obrigatório para qualquer desenvolvedor ou agente IA que trabalhe neste projeto.
**Leia tudo antes de fazer qualquer alteração.**

---

## Stack

| Camada | Tecnologia |
|---|---|
| Backend | Node.js + Express |
| Templates | EJS (não React, não Next.js) |
| Banco de dados | Supabase (PostgreSQL) — projeto operacional `mckldrujoktkhjzgdded` |
| Autenticação | Supabase Auth customizado (tabela `user_profiles`) |
| Email | Resend SDK (`resend` npm) |
| IA (Lina) | Google Gemini 2.5 Flash via API REST |
| Deploy | Railway — auto-deploy via push no `main` do GitHub |
| Repositório | GitHub: nathanmeireles1/paytcall-suporte |
| Domínio | https://operacao.paytcall.com.br |

---

## Supabase

- **Projeto operacional** (ÚNICO banco em uso): `mckldrujoktkhjzgdded`
- **Projeto hub** (`cclvcemrxpucpxaywopc`): migração concluída — pode ser deletado
- **Projeto gestão** (`cclvcemrxpucpxaywopc` — portal-gestao): leitura de `rh_colaboradores` via `dbGestao`
- Clientes configurados em `src/config/database.js` — usar sempre `db` (operacional); `dbGestao` para colaboradores
- Nunca usar anon key para operações admin — sempre service role key via variável de ambiente
- Storage bucket `produtos-midias`: limite por arquivo configurado em 500MB (`storage.buckets.file_size_limit`)
- Acesso à Management API via `SUPABASE_ACCESS_TOKEN` no `.env` local

---

## Estrutura de pastas

```
src/
  app.js              — entrada da aplicação Express
  config/
    database.js       — clientes Supabase (db = operacional, dbGestao = portal-gestao)
  middleware/
    auth.js           — requireAuth, requirePermission, loadPermissions
  routes/
    admin.js          — /admin/* (usuários, permissões, configurações, docs, IA)
    ai.js             — /api/ai/chat (Lina — Gemini)
    auth.js           — /login, /logout, /invite/:token
    dashboard.js      — /dashboard, /rastreios (handler compartilhado handleRastreios)
    gestao.js         — /gestao/* (catálogo: empresas, produtos, nichos, feedbacks, vendas; /gestao/bi redireciona para /admin/bi)
    relatorios.js     — /relatorios/* (tickets, rastreio-log, cancelamentos, logística, retenção)
    tracking.js       — /rastreios, /pedido/:id, refresh
    webhook.js        — /webhook (Paytcall)
  services/
    mailer.js         — envio de email via Resend
    scheduler.js      — cron 08:00 e 14:00 BRT (atualiza rastreios via H7)
    haga7.js          — integração API H7 (rastreio por CPF)
  views/
    partials/
      sidebar.ejs       — navegação lateral (roles controlam visibilidade) + toggle de tema
      topbar.ejs        — barra superior com notificações + showConfirm() global
      ai-chat.ejs       — widget flutuante da Lina
      feedback-list.ejs — lista de feedbacks com edit/delete inline
      pagination.ejs    — paginação universal (info + ellipsis + ir para + por página)
    login.ejs
    invite.ejs          — página de aceite de convite
    dashboard.ejs       — tabela de rastreios com filtros
    shipment.ejs        — página do pedido individual
    gestao-catalogo.ejs         — Catálogo (abas: Empresas | Produtos | Nichos)
    gestao-empresa-detalhe.ejs  — Detalhe de empresa + produtos vinculados + feedbacks
    gestao-produto-detalhe.ejs  — Detalhe de produto + mídias (lightbox) + feedbacks
    gestao-vendas.ejs           — Dashboard de vendas (RPC get_vendas_dashboard + dailyByRegiao + ranking por abas)
    gestao-colaboradores.ejs    — Visualização de colaboradores (somente admin; fonte: rh_colaboradores do portal-gestao)
    gestao-bi.ejs               — Power BI embed (config em tabela configuracoes) — acessado via /admin/bi
    relatorios-tickets.ejs
    relatorios-rastreio-log.ejs
    relatorios-cancelamentos.ejs
    relatorios-logistica.ejs
    relatorios-solicitacoes.ejs
    admin-configuracoes.ejs  — Usuários + Permissões + Sistema (abas)
    admin-docs.ejs    — documentação do sistema
    admin-ia.ejs      — página dedicada ao agente Lina
    admin-mural.ejs   — mural de avisos
    admin-bi.ejs      — Power BI embed (admin only; rota GET /admin/bi)
  public/
    css/global.css    — design system completo (NUNCA criar CSS inline fora do padrão)
scripts/
  migrate-hub-to-operacional.mjs  — migra empresas, produtos, feedbacks, configuracoes + storage
  import-payt-pedidos.mjs         — importa pedidos de planilhas Excel Paytcall
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

> **Regra absoluta: TODO elemento visual do portal deve usar o design system — sem exceções.**
> Isso inclui tabelas, modais, botões, gráficos, dropdowns, filtros, badges, formulários, ícones, cores, espaçamentos e **janelas de confirmação**.
> Nunca criar componentes visuais fora do padrão, mesmo que seja "só um filtro" ou "só um botão".

- **Sempre** usar classes do `global.css`: `card`, `card-header`, `card-body`, `card-footer`, `btn`, `btn-primary`, `btn-secondary`, `btn-sm`, `form-input`, `form-select`, `form-label`, `form-group`, `badge`, `table-wrap`, `toolbar`, `pagination`, `pagination-bar`
- **Nunca** criar estilos inline que dupliquem o que o design system já oferece
- **Dropdowns de filtro** usam o componente `multiselect-wrap` + `multiselect-btn` + `multiselect-dropdown` — nunca usar `<select>` nativo em barras de filtro de dashboards
- **Labels de filtros** usam o nome da dimensão (ex: "Empresas", "Tipo", "Pagamento") — não prefixar com "Todos/Todas"
- Modais seguem o padrão: overlay `rgba(0,0,0,.45)` + `class="card"` + `card-header` + `card-body` + `card-footer`
- **Confirmações destrutivas:** usar `showConfirm(message, onOk, { okLabel, okClass })` — função global definida em `partials/topbar.ejs`. **NUNCA usar `confirm()`, `alert()` ou `prompt()` nativos do browser.**
- Page headers com título + botões: usar `p-page-header` > `p-page-header-left` + `p-page-header-right`
- Formulários: sempre envolver `label` + `input` em `<div class="form-group">` (flex-column, gap:5px)
- Paginação: usar `<%- include('partials/pagination', { pages, currentPage, total, perPage }) %>` — NUNCA reimplementar manualmente
- Cores via variáveis CSS: `var(--brand)`, `var(--success)`, `var(--danger)`, `var(--warning)`, `var(--info)`, `var(--text)`, `var(--text-3)`, `var(--text-4)`, `var(--border)`
- Páginas públicas (login, invite) têm design próprio — não usam `global.css`

---

## Regras de desenvolvimento

### Git — obrigatório
- **Nunca commitar direto no `main`**
- Cada feature/fix em branch separada: `feat/nome`, `fix/nome`
- PR obrigatório — merge via `gh pr merge` após revisão
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
| `SUPABASE_ACCESS_TOKEN` | Personal access token Supabase (Management API — apenas .env local) |
| `RESEND_API_KEY` | Chave da API Resend para envio de emails |
| `SMTP_FROM` | Remetente dos emails: `Paytcall Operações <sistema@paytcall.com.br>` |
| `APP_URL` | `https://operacao.paytcall.com.br` |
| `GEMINI_API_KEY` | Fallback da chave Gemini (também configurável via painel em portal_settings) |
| `SESSION_SECRET` | Secret para cookies de sessão |
| `ADMIN_PASS` | Senha admin de emergência |
| `WONCA_API_KEY` | Chave API H7 para consulta de rastreios por CPF |
| `HUB_SUPABASE_URL` | URL do projeto hub (apenas para scripts de migração) |
| `HUB_SUPABASE_SERVICE_KEY` | Service role key do hub (apenas para scripts de migração) |
| `GESTAO_SUPABASE_URL` | URL do Supabase do portal-gestao (leitura de rh_colaboradores) |
| `GESTAO_SUPABASE_SERVICE_KEY` | Service role key do portal-gestao |

---

## Comportamentos automáticos (Scheduler)

- Roda às **08:00 e 14:00 BRT** via `node-cron`
- Consulta todos os rastreios ativos na API H7 por CPF
- Promove pedidos da `customer_queue` para `shipments` quando código de rastreio é encontrado
- **Fecha automaticamente** tickets LOGISTICA/Envio quando movimentação é detectada
- **Fecha automaticamente** tickets de "sem rastreio" quando pedido é promovido da fila
- Cada execução é registrada em `scheduler_logs` com breakdown por status

---

## Tabelas principais do Supabase operacional (`mckldrujoktkhjzgdded`)

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
| `empresas` | Empresas parceiras (nome, segmento, cnpj, email, telefone, contato, cidade, estado, site, descricao, status, logo_url) |
| `produtos` | Produtos do catálogo (nome, empresa, nicho, sku, o_que_e, como_funciona, composicao, descricao, imagem_url, playbook_slug, status) |
| `feedbacks` | Feedbacks sobre empresas/produtos (autor, empresa, produto, texto, dt_criacao) |
| `configuracoes` | Configurações variadas (id text PK, valor jsonb) — ex: powerbi embed URL |

---

## Fluxo de convite de usuário

1. Admin cria usuário **com senha** → ativo imediatamente via `db.auth.admin.createUser()`
2. Admin cria usuário **sem senha** → token gerado, email enviado via Resend, link expira em 7 dias
3. Admin pode reenviar convite (renova token + reenvia email)
4. Admin pode excluir apenas usuários **pendentes** (sem `auth_id`)
5. Admin pode alterar senha de usuários ativos via `db.auth.admin.updateUserById()`

---

## Módulo Catálogo (Gestão)

- Rota base: `/gestao/*` em `src/routes/gestao.js`
- Usa **`db` (Supabase operacional)** para todas as operações — migração do hub concluída
- Permissões: `canEdit` = admin OU `role_permissions.catalogo.can_edit`; `canDelete` = admin only
- Mídias de produtos: Storage bucket `produtos-midias`, path `playbooks/{slug}/fotos/` e `playbooks/{slug}/depoimentos/`
  - Limite por arquivo: 500MB (configurado em `storage.buckets` via SQL)
  - Layout: grade de miniaturas 110px; clique abre lightbox (`openLightbox(url, type)` definida em gestao-produto-detalhe.ejs)
- Vinculação produto ↔ empresa: campo `produtos.empresa` (text) deve conter o nome exato da empresa
- Nichos são derivados do campo `produto.nicho` (sem tabela própria)
- Feedbacks: qualquer usuário cria; autor ou admin pode editar/excluir
- Power BI: rota `/admin/bi` (admin only) lê `configuracoes` onde `id = 'powerbi'` (valor jsonb com `embedUrl` e `pageName`); `/gestao/bi` redireciona para lá

---

## Módulo Vendas (Dashboard)

- Rota: `GET /gestao/vendas` e `GET /gestao/api/vendas` em `src/routes/gestao.js`
- API principal usa RPC `get_vendas_dashboard` + agregação Node.js de `formasData`
- **Cache em memória 45s**: chave por role + todos os parâmetros de filtro
- **Colaboradores** (fonte única): `getColaboradores()` lê `rh_colaboradores` via `dbGestao`; cache 5 min
- **dailyByRegiao**: computado a partir de `formasData` (email + dt_aprovacao) cruzado com `emailToRegiao` — alimenta linhas regionais no gráfico Faturamento por Dia
- **Ranking de Vendedoras**: tab por região (Geral / Natal / Palhoça) no mesmo card; dados em `rankingByRegiao`; exibe `nome` real do colaborador (campo `rh_colaboradores.nome`)
- **Lite mode** (`?lite=1`): skip de `formasData` — usado para chamada do período anterior (só KPIs)
- Regiões usadas: valores do campo `rh_colaboradores.unidade` (ex: "Natal", "Palhoça")
- **Diagnóstico**: ao carregar (sem cache), log `[Vendas/dailyByRegiao]` no Railway mostra contagem de matches por região

## Responsividade

- **Breakpoints em `public/css/global.css`**:
  - `≤ 1200px`: `.grid-2` e `.col-layout-2` → 1 coluna; `.grid-3/.grid-4` → 2 colunas
  - `≤ 1024px`: `.p-summary` → 4 colunas fixo
  - `≤ 768px`: sidebar some; todos os grids → 1 coluna
- **`.col-layout-2`**: classe utilitária para grids de 2 colunas com colapso em 1200px — usar em vez de `style="display:grid;grid-template-columns:1fr 1fr"` nas views
- **gestao-vendas.ejs**: `.charts-grid` e `.tables-grid` colapsam em 1200px (não em 900px)

## Importação de pedidos (scripts/)

### `import-payt-pedidos.mjs`
- Importa pedidos de planilhas `.xlsx` exportadas da Paytcall
- Pedidos com código de rastreio → `shipments`; sem código → `customer_queue`
- Upsert `onConflict: 'tracking_code'` / `onConflict: 'order_id'` (ignora duplicados)
- Sellers configurados no array `FILES` dentro do script — cada entrada tem `seller_id` e `company_name`
- **`total_price` = sempre coluna `f. Saldo da Venda`** (independente de juros — regra para planilhas Excel)
- **`product_price` = sempre coluna `Valor da Venda`**
- Campos mapeados: `order_id`, `customer_*`, `product_name`, `product_sku`, `product_quantity`, `product_price`, `total_price`, `payment_method`, `sale_type`, `paid_at`, `tracking_code`, `tracking_url`, `shipping_address` (JSON montado de Rua/Número/Complemento/Bairro/Cidade/Estado/CEP)
- Colunas esperadas no Excel Paytcall: `Código`, `Cliente`, `Tipo Venda`, `Sku`, `Produto`, `Quantidade de produtos`, `Status Pagamento`, `Valor da Venda`, `Saldo da Venda`, `Forma de Pagamento`, `Data`, `Email`, `Documento`, `Telefone`, `Código de Rastreio`, `Url de Acompanhamento`, `Rua`, `Número`, `Complemento`, `Bairro`, `Cidade`, `Estado`, `CEP`

### Lógica de juros — SOMENTE webhook
A distinção entre `total_price` (com juros) e `product_price` (sem juros) aplica-se **exclusivamente a pedidos que chegam via webhook**. A lista canônica `COMPANIES_WITH_INTEREST` está no topo de `src/routes/webhook.js`. Para planilhas Excel (import script ou web importer), sempre usar `f. Saldo da Venda` como `total_price` — sem exceções.

### `migrate-hub-to-operacional.mjs`
- Migra tabelas `empresas`, `produtos`, `feedbacks`, `configuracoes` do hub para operacional
- Migra storage `produtos-midias` e `empresas-logos`
- Pode ser re-executado (upsert idempotente)

---

## Paginação universal

Todas as páginas com tabelas usam o partial `partials/pagination.ejs`.

**Como passar os dados:**
1. Na rota, ler `perPage` do query: `const limit = parsePerPage(req.query.perPage)` (valores válidos: 25, 50, 100, 200)
2. Passar ao render: `{ pages, currentPage, total, perPage: limit }`
3. Na view: `<%- include('partials/pagination', { pages, currentPage, total, perPage }) %>`

O partial preserva todos os query params automaticamente via `window.location`.

---

*Atualizado em: 2026-04-09*
*Migração hub → operacional: CONCLUÍDA. Hub pode ser deletado.*
*Integração portal-gestao (rh_colaboradores): CONCLUÍDA. Variáveis GESTAO_SUPABASE_URL e GESTAO_SUPABASE_SERVICE_KEY já no Railway.*
*Lógica de juros: webhook usa COMPANIES_WITH_INTEREST (total_price vs product_price); planilha Excel sempre usa f. Saldo da Venda.*
*Performance vendas: RPCs get_vendas_formas_nichos + get_vendas_ranking_agg + índice idx_vendas_status_dt criados. Agregação server-side, ~500ms.*
*Nichos: coluna `nicho` adicionada em `vendas`. Atualmente vazia (nomes Paytcall não batem com catálogo). Populável via import futuro.*
*Módulo "Gestão" renomeado para "Comercial" no sidebar.*
