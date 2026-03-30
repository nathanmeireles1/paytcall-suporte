# Levantamento Técnico — Migração Portal de Vendas → Node.js/Express/EJS

> Gerado em: 2026-03-30
> Portal origem: `https://gestao.paytcall.com.br`
> Stack destino: Node.js / Express / EJS / Supabase

---

## 0. ARQUITETURA E HOSPEDAGEM ATUAL

**Framework:** Next.js App Router (não Pages Router). Versão `^16.2.1`.

**`next.config.ts` completo:**
```typescript
import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cclvcemrxpucpxaywopc.supabase.co" },
    ],
  },
};
export default nextConfig;
```

**Hospedagem:** Vercel.

**`vercel.json` completo:**
```json
{
  "crons": [
    {
      "path": "/api/sync/airtable",
      "schedule": "0 0 * * *"
    }
  ]
}
```

**Pasta principal:** `src/app/` (App Router)

**Estrutura de diretórios (3 níveis):**
```
src/
├── app/
│   ├── (app)/                    # Grupo de rotas privadas (requer auth)
│   │   ├── layout.tsx            # Layout base (sidebar + header)
│   │   ├── dashboard/page.tsx
│   │   ├── vendas/
│   │   │   ├── page.tsx          # Server component (busca user/equipe)
│   │   │   └── VendasDashboard.tsx  # Client component (549 linhas)
│   │   ├── empresas/
│   │   │   ├── page.tsx
│   │   │   └── [id]/page.tsx
│   │   ├── produtos/
│   │   │   ├── page.tsx
│   │   │   └── [id]/page.tsx
│   │   ├── segmentos/
│   │   │   ├── page.tsx
│   │   │   └── [slug]/page.tsx
│   │   ├── notas/page.tsx
│   │   ├── feedback/page.tsx
│   │   ├── sugestoes/page.tsx
│   │   ├── avisos/page.tsx
│   │   ├── perfil/page.tsx
│   │   ├── lina/page.tsx
│   │   ├── bi/
│   │   │   ├── page.tsx
│   │   │   └── PowerBIPanel.tsx
│   │   ├── admin/
│   │   │   ├── page.tsx
│   │   │   └── AdminTabs.tsx
│   │   └── rh/
│   │       ├── dashboard/page.tsx
│   │       ├── colaboradores/[id]/page.tsx
│   │       ├── ferias/page.tsx
│   │       └── folha/
│   │           ├── page.tsx
│   │           └── relatorio/page.tsx
│   ├── api/
│   │   ├── sync/airtable/route.ts
│   │   ├── lina/route.ts
│   │   └── convite/
│   │       ├── validar/route.ts
│   │       └── aceitar/route.ts
│   ├── login/page.tsx
│   ├── convite/[token]/page.tsx
│   ├── layout.tsx
│   ├── page.tsx                  # Redireciona para /dashboard
│   └── globals.css
├── components/
│   └── layout/
│       ├── Sidebar.tsx
│       ├── Header.tsx
│       └── ThemeProvider.tsx
├── lib/
│   ├── supabase/
│   │   ├── server.ts
│   │   ├── client.ts
│   │   ├── middleware.ts
│   │   └── service.ts
│   ├── permissions.ts
│   ├── displayName.ts
│   └── rh/
├── types/
│   └── database.ts
└── middleware.ts

scripts/
├── sync-airtable.mjs
├── import-vendas-xlsx.mjs
└── import-rh-xlsx.mjs

public/
└── design-prompt.md

planilhas/
└── Airtable/                     # .xlsx a importar
```

**Domínio atual:** `https://gestao.paytcall.com.br`

---

## 1. TODAS AS PÁGINAS, ROTAS E O QUE EXIBEM

### `/dashboard`
- **Tipo:** Server Component
- **Acesso:** Todos os roles
- **Seções:**
  - Greeting com nome/apelido do usuário
  - 4 KPI cards: Total Empresas, Usuários, Produtos, Segmentos
  - Quick cards: links para `/produtos`, `/empresas`, `/segmentos`
  - Mural de Avisos (últimos 10)
  - Agenda CRM (últimas 20 notas do usuário logado)
- **Queries:**
```sql
SELECT COUNT(*) FROM empresas;
SELECT COUNT(*) FROM usuarios;
SELECT COUNT(*) FROM produtos;
SELECT nicho FROM produtos WHERE nicho IS NOT NULL;  -- conta distinct no app
SELECT * FROM avisos ORDER BY dt_criacao DESC LIMIT 10;
SELECT * FROM notas WHERE user_id = $userId ORDER BY dt_criacao DESC LIMIT 20;
SELECT nome, apelido FROM usuarios WHERE id = $userId;
```

---

### `/vendas`
- **Tipo:** Server Component (page.tsx) + Client Component (VendasDashboard.tsx)
- **Acesso:** Todos — escopo de dados difere por role
- **Seções:**
  - Painel de filtros (período, equipe, tipo, Empresas MultiSelect, Produtos MultiSelect)
  - 4 KPI cards: Faturamento, Ticket Médio, Chargebacks, Formas de Pagamento
  - Gráfico de área: Faturamento por Dia (Recharts AreaChart → migrar para Chart.js)
  - Tabela Top 10 Empresas (por faturamento)
  - Tabela Top 10 Produtos (por quantidade)
  - Gráfico de barras horizontais: Top 7 Produtos (Recharts BarChart → Chart.js)
  - Tabela "Vendas por Dia" com scroll (mais recente primeiro)

**Filtros disponíveis:**

| Filtro | Tipo | Comportamento |
|--------|------|---------------|
| Período | botões toggle | `7d`, `30d`, `90d`, `12m`, `all`, `custom` |
| Equipe | `<select>` | Admin vê todas; supervisor vê a sua; vendedor não vê |
| Tipo de Venda | `<select>` | Valores distintos de `tipo_venda` |
| Empresas | MultiSelect (dropdown) | Filtro multi com busca e checkbox |
| Produtos | MultiSelect (dropdown) | Idem |

**Queries principais (todas filtram `status_pagamento = 'paid'`):**
```sql
-- KPI agregado
SELECT SUM(valor_venda) AS faturamento, COUNT(id) AS total
FROM vendas
WHERE status_pagamento = 'paid'
  AND dt_aprovacao BETWEEN $dateFrom AND $dateTo
  [AND email IN ($emails)]
  [AND tipo_venda = $tipo]
  [AND empresa IN ($empresas)]
  [AND produto IN ($produtos)];

-- Forma de pagamento
SELECT forma_pagamento, COUNT(id) AS count
FROM vendas
WHERE status_pagamento = 'paid' AND [filtros acima]
GROUP BY forma_pagamento;

-- Chargebacks
SELECT COUNT(id) AS count
FROM vendas
WHERE status_pagamento = 'chargeback' AND [filtros acima exceto status];

-- Daily (gráfico de área + tabela)
SELECT dt_aprovacao, SUM(valor_venda) AS total, COUNT(id) AS count
FROM vendas
WHERE status_pagamento = 'paid' AND dt_aprovacao IS NOT NULL AND [filtros]
GROUP BY dt_aprovacao
ORDER BY dt_aprovacao ASC;

-- Top Empresas
SELECT empresa, SUM(valor_venda) AS total, COUNT(id) AS count
FROM vendas
WHERE status_pagamento = 'paid' AND empresa IS NOT NULL AND [filtros]
GROUP BY empresa
ORDER BY total DESC LIMIT 10;

-- Top Produtos
SELECT produto, SUM(valor_venda) AS total, COUNT(id) AS count
FROM vendas
WHERE status_pagamento = 'paid' AND produto IS NOT NULL AND [filtros]
GROUP BY produto
ORDER BY count DESC LIMIT 10;
```

**Resolução de emails por role:**
```
admin  + filterEquipe="all"   → sem filtro de email (vê tudo)
admin  + filterEquipe=$equipe → emails WHERE equipe=$equipe AND ativo=true
supervisor                    → emails WHERE equipe=$equipe AND ativo=true
vendedor                      → [userEmail] direto
```

---

### `/empresas`
- Tabela de todas as empresas (nome, segmento, status, contato)
- `SELECT * FROM empresas ORDER BY nome`

### `/empresas/:id`
- Detalhe da empresa + notas/follow-ups vinculados
- `SELECT * FROM notas WHERE empresa_id = $id`

### `/produtos`
- Grid organizado por nicho/categoria
- `SELECT * FROM produtos ORDER BY nome`

### `/produtos/:id`
- Detalhe: `o_que_e`, `composicao`, `como_funciona`, `descricao`
- Playbook: fotos e depoimentos do Supabase Storage (`playbooks/{slug}/fotos/`)

### `/segmentos`
- Cards de nichos com count de produtos
- `SELECT nicho, COUNT(*) FROM produtos GROUP BY nicho`

### `/segmentos/:slug`
- `SELECT * FROM produtos WHERE nicho = $slug`

### `/notas`
- Grid de notas do usuário com destaque para `data_followup`
- `SELECT * FROM notas WHERE user_id = $userId ORDER BY dt_criacao DESC`

### `/feedback`
- `SELECT * FROM feedbacks ORDER BY dt_criacao DESC`

### `/sugestoes`
- `SELECT * FROM sugestoes ORDER BY dt_criacao DESC`

### `/avisos`
- Mural colorido por tipo: urgente, importante, info, geral
- `SELECT * FROM avisos ORDER BY dt_criacao DESC`

### `/bi`
- **Acesso:** somente `admin` (`can(role, "acessar_bi")`)
- Iframe do Power BI
- Config: `SELECT valor FROM configuracoes WHERE id = 'powerbi'`
- `valor` é JSON: `{ "embedUrl": "...", "pageName": "..." }`
- URL do iframe: `embedUrl + (pageName ? "&pageName=pageName" : "")`

### `/admin`
- **Acesso:** somente `admin` (`can(role, "acessar_configuracoes")`)
- Abas: Usuários, Avisos, Produtos, Empresas, Power BI, Nichos, Permissões, Lina
- Queries: `SELECT * FROM usuarios`, `SELECT * FROM avisos`, etc.
- Configs via `configuracoes` (ids: `powerbi`, `nichos`, `permissoes`, `lina_permissoes`)

### `/rh/*`
- **Acesso:** somente `admin`
- `/rh/dashboard` → KPIs de colaboradores
- `/rh/colaboradores` → `SELECT * FROM rh_colaboradores`
- `/rh/ferias` → `SELECT * FROM rh_ferias JOIN rh_colaboradores`
- `/rh/folha` e `/rh/folha/relatorio` → dados de salário/folha

### `/lina`
- Chat com Gemini 2.0 Flash via `POST /api/lina`
- Visível na sidebar somente para `admin`

### `/perfil`
- Edição: nome, apelido, senha, avatar

---

## 2. LÓGICA DE PERMISSÕES COMPLETA

**Tabela e campo:** `usuarios.role` — valores: `"admin"`, `"supervisor"`, `"vendedor"`

**Identificação do role:**
```typescript
// Em cada page/layout:
const { data: { user } } = await supabase.auth.getUser();
const { data: usuario } = await supabase
  .from("usuarios").select("*").eq("id", user.id).single();
// usuario.role é o role
```

**Middleware (`src/middleware.ts`):**
```typescript
// Roda em Edge Runtime em TODAS as rotas exceto:
// _next/static, _next/image, favicon, assets/, api/sync/, *.svg/png/jpg/jpeg/gif/webp
// Lógica:
// - Não logado + não é /login → redirect /login
// - Logado + é /login         → redirect /dashboard
// NÃO verifica role — isso é feito em cada page individualmente
```

**Supervisor → equipe:**
- `vendas_colaboradores.equipe` vincula email do vendedor a uma equipe
- Para filtrar vendas: `SELECT email FROM vendas_colaboradores WHERE equipe = $equipe AND ativo = true` → `WHERE email IN ($emails)`

**Vendedor → próprias vendas:**
- Filtro: `WHERE email = $userEmail` (email do usuário = email em `vendas.email`)

**Tabela `vendas_colaboradores` (chave de ligação):**

| Campo | Tipo | Uso |
|-------|------|-----|
| `email` | text | Liga usuário → vendas |
| `primeiro_nome` | text | Nome de exibição |
| `equipe` | text | Nome da equipe do supervisor |
| `regiao` | text | Região geográfica |
| `ativo` | boolean | Se deve aparecer nos filtros |

**Sistema de permissões completo (`src/lib/permissions.ts`):**
```typescript
export const PERMISSIONS = {
  convidar_usuarios:      ["admin", "supervisor"],
  alterar_roles:          ["admin"],
  desativar_usuarios:     ["admin"],
  criar_empresa:          ["admin", "supervisor"],
  editar_empresa:         ["admin", "supervisor"],
  deletar_empresa:        ["admin"],
  criar_produto:          ["admin", "supervisor"],
  editar_produto:         ["admin", "supervisor"],
  deletar_produto:        ["admin"],
  upload_midia:           ["admin", "supervisor"],
  publicar_aviso:         ["admin", "supervisor"],
  deletar_aviso:          ["admin"],
  publicar_feedback:      ["admin", "supervisor", "vendedor"],
  ver_notas_equipe:       ["admin", "supervisor"],
  acessar_configuracoes:  ["admin"],
  gerenciar_integracoes:  ["admin"],
  ver_logs_auditoria:     ["admin"],
  criar_nicho:            ["admin", "supervisor"],
  editar_nicho:           ["admin", "supervisor"],
  deletar_nicho:          ["admin"],
  acessar_bi:             ["admin"],
  acessar_rh:             ["admin"],
  editar_colaborador:     ["admin"],
};

export function can(role, permission) {
  return PERMISSIONS[permission].includes(role);
}
```

**RLS:** Não há RLS customizada documentada nas tabelas de vendas. Controle de escopo é 100% na aplicação.

**Service role key vs anon key:**
- `ANON_KEY` → `createServerClient()` / `createBrowserClient()` — operações autenticadas com sessão do usuário
- `SERVICE_ROLE_KEY` → `createServiceClient()` — usado apenas em: `/api/sync/airtable`, `/api/lina`, `/api/convite/aceitar`, scripts de importação

---

## 3. DASHBOARD DE VENDAS — DETALHE COMPLETO

### KPI Cards e fórmulas exatas

| KPI | Fórmula |
|-----|---------|
| **Faturamento** | `SUM(valor_venda) WHERE status_pagamento = 'paid'` |
| **Ticket Médio** | `faturamento / COUNT(id)` (0 se total=0) |
| **Chargebacks** | `COUNT(id) WHERE status_pagamento = 'chargeback'` |
| **Taxa Chargeback** | `chargebacks / (total_vendas_paid + chargebacks) * 100` — vermelho se > 5% |
| **Pix** | `COUNT(id) WHERE status_pagamento='paid' AND forma_pagamento='pix'` |
| **Cartão** | `COUNT(id) WHERE status_pagamento='paid' AND forma_pagamento='credit_card'` |

### Gráfico de área diário
- **Campo de data:** `dt_aprovacao` (string `YYYY-MM-DD`)
- **Timezone:** nenhum ajuste — data usada como veio do Airtable
- **Agrupamento:** `GROUP BY dt_aprovacao` no Supabase
- **Ordenação:** `ORDER BY dt_aprovacao ASC`
- **Formatação eixo X:** `dd/mm` (split por `-`, inverte posições 0/2/1)
- **Eixo Y:** `R$ Xk` (divide por 1000)

### Top Empresas
- Ordenado por `SUM(valor_venda) DESC`
- Exibe: rank, nome, qtd vendas, faturamento
- Limite: 10

### Top Produtos
- Ordenado por `COUNT(*) DESC` (**quantidade**, não faturamento)
- Exibe: rank, produto, qtd, faturamento
- Limite: 10

### Tabela Vendas por Dia
- Mesmos dados do gráfico diário, ordem reversa (mais recente primeiro)
- Colunas: Data (`dd/mm/yyyy`), Vendas (qtd), Faturamento, Ticket Médio
- Ticket Médio por linha: `valor/qtd` (exibe `—` se qtd=0)

### Lógica de períodos
```javascript
"7d"     → new Date() - 7 dias
"30d"    → new Date() - 30 dias
"90d"    → new Date() - 90 dias
"12m"    → new Date() - 365 dias
"all"    → "2000-01-01" até hoje
"custom" → inputs livres (fallback "2000-01-01" se vazio)
```

---

## 4. TODAS AS INTEGRAÇÕES

### Airtable → Supabase

**Credenciais:**
- Base ID: `app7yGrrGT2O7zUzu`
- Table ID: `tblY0gL9GzLQBh6zf`
- Auth: `Authorization: Bearer $AIRTABLE_TOKEN`

**Mapeamento completo campo Airtable → coluna Supabase:**

| Campo Airtable | Coluna Supabase | Observação |
|----------------|-----------------|------------|
| `Código` | `codigo` | **Chave do upsert** |
| `rec.id` (nativo) | `airtable_id` | ID do registro no Airtable |
| `Tipo Venda` | `tipo_venda` | |
| `Sku` | `sku` | |
| `Produto` | `produto` | |
| `Empresa` | `empresa` | |
| `Email formatado` ou `Email` | `email` | Preferência: `Email formatado` |
| `Status Pagamento` | `status_pagamento` | `paid`, `chargeback`, etc. |
| `f. Valor da Venda` ou `Valor da Venda` | `valor_venda` | float BRL |
| `f. Saldo da Venda` ou `Saldo da Venda` | `saldo_venda` | float BRL |
| `Forma de Pagamento` | `forma_pagamento` | `pix`, `credit_card` |
| `Data de aprovação` | `dt_aprovacao` | string ISO |
| `Data de criação` | `dt_criacao` | string ISO |
| `Nome` | `nome_cliente` | |
| `Telefone` | `telefone` | |
| `Documento` | `documento` | |
| `Status de auditoria` | `status_auditoria` | |
| `Status de atendimento` | `status_atendimento` | |
| hardcoded `"airtable"` | `fonte` | |

**Chave única do upsert:** `codigo` (`onConflict: "codigo"`)

**Frequência:** Diariamente às 00:00 UTC (`0 0 * * *`)

**Paginação:** 100 registros/página, loop por `offset`

**Proteção do endpoint:** `Authorization: Bearer $CRON_SECRET`

**Função `clean(v)`:** converte `null`, `""`, `"-"` → `null`

---

### Power BI

**Armazenamento:** `SELECT valor FROM configuracoes WHERE id = 'powerbi'`

`valor` é JSON:
```json
{ "embedUrl": "https://app.powerbi.com/reportEmbed?...", "pageName": "ReportSection..." }
```

**Montagem do src do iframe:**
```javascript
const src = pageName ? `${embedUrl}&pageName=${pageName}` : embedUrl;
```

**Acesso:** somente `admin`

**Componente PowerBIPanel.tsx (completo):**
```tsx
"use client";
import { BarChart2 } from "lucide-react";

export default function PowerBIPanel({ embedUrl, pageName }) {
  if (!embedUrl) {
    return (
      <div className="h-full min-h-96 ...">
        <BarChart2 size={48} strokeWidth={1} />
        <p>Painel não configurado</p>
        <p>Configure a URL do Power BI em Configurações</p>
      </div>
    );
  }
  const src = pageName ? `${embedUrl}&pageName=${pageName}` : embedUrl;
  return (
    <div className="h-full min-h-[600px] ...">
      <iframe src={src} allowFullScreen title="Painel Power BI"
        style={{ border: "none", minHeight: "600px", width: "100%", height: "100%" }} />
    </div>
  );
}
```

---

### XLSX (planilhas de vendas)

**Pasta:** `planilhas/Airtable/*.xlsx`

**Mapeamento colunas → Supabase:**

| Coluna Excel | Campo Supabase |
|-------------|----------------|
| `Código` ou `Codigo` | `codigo` |
| `Tipo Venda` | `tipo_venda` |
| `Sku` ou `SKU` | `sku` |
| `Produto` | `produto` |
| `Empresa` | `empresa` |
| `Email formatado` ou `Email` | `email` |
| `Status Pagamento` | `status_pagamento` |
| `f. Valor da Venda` ou `Valor da Venda` | `valor_venda` |
| `f. Saldo da Venda` ou `Saldo da Venda` | `saldo_venda` |
| `Forma de Pagamento` | `forma_pagamento` |
| `Data de aprovação` / `Data de aprovacao` | `dt_aprovacao` |
| `Data de criação` / `Data de criacao` | `dt_criacao` |
| `Nome` | `nome_cliente` |
| `Telefone` | `telefone` |
| `Documento` | `documento` |
| `Status de auditoria` | `status_auditoria` |
| `Status de atendimento` | `status_atendimento` |
| hardcoded `"planilha"` | `fonte` |

**Conversão de datas Excel:** `XLSX.SSF.parse_date_code(serial)` → `YYYY-MM-DD`

**Conversão de valores:** se `valor > 10000`, assume centavos → divide por 100

**Deduplicação:** `upsert(..., { onConflict: "codigo", ignoreDuplicates: true })`

**Controle de re-importação:** tabela `vendas_imports` (campos: `filename`, `rows_imported`, `imported_at`). Flag `--force` pula a verificação.

**Batch:** 200 registros por upsert

---

## 5. AUTENTICAÇÃO E SESSÃO

**Mecanismo:** Supabase Auth nativo, email + password (`signInWithPassword`)

**Role salvo:** `usuarios.role` (text)

**Sessão:** Cookie HTTP gerenciado pelo `@supabase/ssr`. O middleware refresh o JWT a cada request lendo/escrevendo cookies automaticamente.

**Auto-criação de perfil (layout.tsx):**
```typescript
// Se usuário autenticado não tem registro em usuarios:
const isAdmin = user.email === "financeiro@paytcall.com.br";
await supabase.from("usuarios").insert({
  id: user.id,
  nome: user.email.split("@")[0],
  email: user.email,
  empresa: "PAYTCALL",
  role: isAdmin ? "admin" : "vendedor",
  status_ativacao: "Ativo",
});
```

**Redirect pós-login:** hardcoded `router.push("/dashboard")`

**Logout:** `supabase.auth.signOut()` → redirect `/login`

**Fluxo de convite:**
1. Admin envia convite → insere em `convites` com token, email, role, expires_at
2. Link enviado por email (Resend): `/convite/$token`
3. `GET /api/convite/validar?token=$token` → verifica status/expiração
4. Usuário preenche nome + senha → `POST /api/convite/aceitar`
5. Cria usuário no Supabase Auth via `admin.createUser({ email, password, email_confirm: true })`
6. Insere em `usuarios` com `role = convite.role`
7. Marca `convites.status = 'aceito'`

**Tabela `convites`:**
```
id, token, email, role, status ("pendente"|"aceito"|"expirado"), expires_at, created_at
```

---

## 6. ARMAZENAMENTO DE ARQUIVOS

**Bucket Supabase Storage:** `produtos-midias`

**Estrutura de pastas (playbooks):**
```
playbooks/
└── {produto.playbook_slug}/
    ├── fotos/
    │   └── *.jpg / *.png
    └── depoimentos/
        └── *.mp4 / *.jpg
```

**Campo de ligação:** `produtos.playbook_slug`

**Fotos de perfil:**
- Bucket: `avatars`
- Campo: `usuarios.avatar_url` (URL pública)
- Upload: `POST /api/profile/photo` (base64)

---

## 7. JOBS AGENDADOS E WEBHOOKS

**Único cron job:** Sync Airtable

| Campo | Valor |
|-------|-------|
| Rota | `GET /api/sync/airtable` |
| Schedule | `0 0 * * *` (meia-noite UTC) |
| Auth | `Authorization: Bearer $CRON_SECRET` |
| Plataforma atual | Vercel Crons |

**Para Express (node-cron):**
```javascript
const cron = require("node-cron");
cron.schedule("0 0 * * *", () => syncAirtable());
```

**Nenhum webhook recebido** de sistemas externos foi identificado.

---

## 8. SIDEBAR E NAVEGAÇÃO

**Estrutura completa (ordem exata, ícones, visibilidade por role):**

```
[Todos os roles]
├── Dashboard           icon: LayoutDashboard
├── Vendas              icon: BarChart2
├── Empresas            icon: Building
├── Segmentos           icon: LayoutGrid
├── Produtos            icon: Package
├── Notas               icon: NotebookPen
├── Feedback            icon: MessageSquare
├── Sugestões           icon: Lightbulb
└── Minha Conta         icon: Settings     ← sem separador, sempre visível

[Somente admin]
── separador ──
"RH & DP" (label)
├── Dashboard RH        icon: BarChart2    href: /rh/dashboard
├── Colaboradores       icon: Users        href: /rh/colaboradores
├── Relatório de Férias icon: Umbrella     href: /rh/ferias
├── Folhas de Pagamento icon: NotebookPen  href: /rh/folha
└── Relatório Folha     icon: FileBarChart2 href: /rh/folha/relatorio
── separador ──
"Sistema" (label)
├── Agente Lina         icon: Sparkles     href: /lina
├── Relatório BI        icon: PieChart     href: /bi
└── Configurações       icon: Settings2    href: /admin
```

**Active state:** `pathname === href || pathname.startsWith(href + "/")`

**Dark mode toggle + logout:** botões no `itau-user-footer` (Sun/Moon icon e LogOut icon)

**Layout base estrutura HTML:**
```
.app-layout (flex row)
├── .itau-sidebar (220px, position: fixed)
├── .itau-header  (52px, position: fixed, left: 220px)
└── .itau-main-wrapper (margin-left: 220px, margin-top: 52px, overflow-y: auto)
```

---

## 9. COMPONENTES E CÓDIGO

### `VendasDashboard.tsx` — estrutura completa

**Props recebidas:**
```typescript
{
  userEmail: string;      // email do usuário logado
  userRole: string;       // "admin" | "supervisor" | "vendedor"
  equipe: string | null;  // equipe do usuário em vendas_colaboradores
  regiao: string | null;  // região
  isAdmin: boolean;
  isSupervisor: boolean;
}
```

**State:**
```typescript
period: Period ("7d"|"30d"|"90d"|"12m"|"all"|"custom")
customFrom, customTo: string (ISO dates)
filterEquipe: string ("all" | nome da equipe)
filterTipo: string ("all" | valor de tipo_venda)
selectedEmpresas: string[]
selectedProdutos: string[]
kpis: KPIs | null
topEmpresas: TopItem[]
topProdutos: TopItem[]
dailyData: DayItem[]
equipes: string[]
tipoOptions: string[]
empresaOptions: string[]
produtoOptions: string[]
loading: boolean
```

**useEffects:**
1. Load equipes (se admin/supervisor) → `vendas_colaboradores WHERE ativo=true`
2. Load tipoOptions → `vendas.tipo_venda DISTINCT LIMIT 2000`
3. Load empresaOptions + produtoOptions (dependente dos filtros)
4. Load main data: KPIs + daily + top empresas + top produtos (re-executa em qualquer mudança de filtro)

**Formatação de valores:**
```javascript
fmt(v)    // R$ 1.234 (BRL currency, 0 decimais)
fmtN(v)   // 1.234 (número BR)
fmtDate(s) // "dd/mm" de "YYYY-MM-DD"
```

---

### `MultiSelect` (componente inline em VendasDashboard.tsx)

**Props:** `{ label: string, options: string[], selected: string[], onChange: (v: string[]) => void }`

**Comportamento:**
- Botão trigger: mostra "Todas {label}" se vazio, nome truncado se 1, "N {label} selecionadas" se múltiplos
- Dropdown: input de busca + lista com checkbox + chips dos selecionados
- Click fora fecha (mousedown event listener em `document`)
- Botão com fundo laranja (`var(--brand)`) quando há seleções
- Footer do dropdown: contador de opções + botão "Limpar"

---

### `PowerBIPanel.tsx` — completo (37 linhas)

Ver seção 4 acima.

---

### Hooks customizados

Nenhum hook customizado separado identificado. Toda lógica de dados está nos `useEffect` do `VendasDashboard.tsx`.

---

### `package.json` completo

```json
{
  "name": "portal-paytcall",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "@google/generative-ai": "^0.24.1",
    "@supabase/ssr": "^0.6.1",
    "@supabase/supabase-js": "^2.49.4",
    "jspdf": "^4.2.1",
    "jspdf-autotable": "^5.0.7",
    "lucide-react": "^0.487.0",
    "next": "^16.2.1",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "recharts": "^3.8.1",
    "resend": "^6.10.0",
    "xlsx": "^0.18.5"
  },
  "devDependencies": {
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "autoprefixer": "^10.4.20",
    "eslint": "^9",
    "eslint-config-next": "^16.2.1",
    "postcss": "^8",
    "tailwindcss": "^3.4.1",
    "typescript": "^5"
  }
}
```

**Para a migração Express/EJS — remover:** `next`, `react`, `react-dom`, `lucide-react`, `recharts`, `@supabase/ssr`

**Adicionar no destino:** `express`, `ejs`, `cookie-parser`, `express-session`, `node-cron`, `chart.js` (CDN)

**Manter:** `@supabase/supabase-js`, `@google/generative-ai`, `jspdf`, `jspdf-autotable`, `resend`, `xlsx`

---

## 10. VARIÁVEIS DE AMBIENTE

```bash
NEXT_PUBLIC_SUPABASE_URL=        # URL do projeto Supabase: https://cclvcemrxpucpxaywopc.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=   # Chave anon — usada no browser e server autenticado (com sessão do usuário)
SUPABASE_SERVICE_ROLE_KEY=       # Chave service role — bypassa RLS, apenas server-side (crons, admin actions)
AIRTABLE_TOKEN=                  # Personal Access Token do Airtable (header: Bearer)
CRON_SECRET=                     # Segredo para autenticar endpoint do cron (valor atual: paytcall-sync-2026)
GEMINI_API_KEY=                  # Google Gemini API Key (para o Agente Lina)
RESEND_API_KEY=                  # Chave da Resend para envio de emails de convite
                                 # ATENÇÃO: no .env.local está como RESENT_API_KEY (typo — falta o D)
NEXT_PUBLIC_SITE_URL=            # URL pública do portal: https://gestao.paytcall.com.br
```

---

## 11. O QUE ESTÁ QUEBRADO, INCOMPLETO OU MOCKADO

1. **`/api/lina` referencia tabelas erradas:**
   - `supabaseService.from("segmentos")` → não existe. Segmentos são nichos em `produtos.nicho`
   - `supabaseService.from("feedback")` → tabela se chama `feedbacks` (com 's')
   - Colunas `produtos.preco` e `produtos.ativo` referenciadas na Lina mas ausentes do schema tipado — podem existir no banco sem tipagem

2. **Typo na env var:** `RESENT_API_KEY` no `.env.local` deveria ser `RESEND_API_KEY`

3. **Tabela `vendas_imports` pode não existir:** usada em `import-vendas-xlsx.mjs` mas não declarada no schema `database.ts`

4. **Portal é desktop-only:** sem breakpoints para mobile, sidebar não colapsa em telas pequenas

5. **Upload de avatar:** referenciado no `design-prompt.md` como `POST /api/profile/photo` mas o endpoint não foi localizado no portal de vendas (pode estar apenas no portal de suporte)

6. **`rh_colaboradores` ≠ `vendas_colaboradores`:** duas tabelas distintas — não confundir:
   - `vendas_colaboradores` → email, equipe, região, ativo (ligação vendedor→equipe)
   - `rh_colaboradores` → dados pessoais completos (CPF, salário, contrato, etc.)

---

## 12. DESIGN SYSTEM

### CSS Custom Properties (`:root` completo)

```css
:root {
  /* Brand */
  --brand: #e47c24;
  --brand-dark: #884710;
  --brand-deeper: #763d0e;
  --brand-light: #fcc48c;
  --brand-warm: #dcccbc;
  --brand-dim: rgba(228,124,36,.10);
  --brand-dim2: rgba(228,124,36,.06);
  --brand-border: rgba(228,124,36,.28);

  /* Surfaces */
  --bg: #faf8f5;
  --bg-2: #ffffff;
  --surface: #ffffff;
  --surface-2: #f7f3ee;
  --surface-3: #ede8e0;

  /* Text */
  --text: #1a1410;
  --text-2: #4a3f35;
  --text-3: #8a7a6a;
  --text-4: #b8aba0;

  /* Borders */
  --border: #e0d8cc;
  --border-2: #cfc5b4;
  --border-3: #bfb09a;

  /* Shadows */
  --shadow-xs: 0 1px 2px rgba(0,0,0,.04);
  --shadow-sm: 0 1px 3px rgba(0,0,0,.07), 0 1px 2px rgba(0,0,0,.04);
  --shadow:    0 4px 8px rgba(0,0,0,.07), 0 1px 3px rgba(0,0,0,.05);
  --shadow-md: 0 10px 20px rgba(0,0,0,.08), 0 4px 8px rgba(0,0,0,.05);
  --shadow-lg: 0 20px 40px rgba(0,0,0,.1),  0 8px 16px rgba(0,0,0,.06);

  /* Semantic */
  --success: #16a34a; --success-bg: #f0fdf4; --success-border: #bbf7d0;
  --warning: #c2800a; --warning-bg: #fefce8; --warning-border: #fde68a;
  --danger:  #dc2626; --danger-bg:  #fef2f2; --danger-border:  #fecaca;
  --info:    #2563eb; --info-bg:    #eff6ff; --info-border:    #bfdbfe;
  --purple:  #7c3aed; --purple-bg:  #f5f3ff; --purple-border:  #ddd6fe;

  /* Layout */
  --sidebar-w: 220px;
  --topbar-h: 52px;
  --radius: 5px;
  --radius-md: 8px;
  --radius-lg: 11px;

  /* Typography */
  --font: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
}

/* Dark Mode — aplicado via html.dark */
html.dark {
  --bg: #1c1c1e;      --bg-2: #242426;
  --surface: #2c2c2e; --surface-2: #363638; --surface-3: #404042;
  --text: #f2f2f2;    --text-2: #d0d0d0;   --text-3: #a0a0a0; --text-4: #686868;
  --border: rgba(255,255,255,.13);
  --border-2: rgba(255,255,255,.18);
}
```

### Dark Mode Toggle (JavaScript puro — para EJS)

```javascript
// No <head> (antes de qualquer render):
const saved = localStorage.getItem('theme');
if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
  document.documentElement.classList.add('dark');
}

// Função de toggle (botão na sidebar):
function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
}
```

### Fontes

```html
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Bebas+Neue&family=Calistoga&display=swap" rel="stylesheet">
```

| Uso | Família | Peso | Tamanho |
|-----|---------|------|---------|
| Títulos de página (h1) | Calistoga | 400 | 26px |
| Corpo / UI | Plus Jakarta Sans | 400–700 | 14px |
| Logotipo "PAYTCALL" na sidebar | Bebas Neue | 400 | 17px |

### Classes CSS principais

```
Layout:
  .app-layout              .itau-sidebar           .itau-header
  .itau-main-wrapper

Sidebar:
  .itau-logo-container     .brand-logo             .brand-name
  .brand-tag               .itau-nav               .itau-nav-item (.active)
  .itau-nav-label          .itau-nav-divider-sub   .itau-user-footer
  .itau-avatar             .itau-name              .itau-role
  .itau-logout-btn

Tipografia:
  .page-header             .page-title             .page-subtitle
  .itau-section-title      .itau-dash-header       .itau-dash-title
  .itau-dash-subtitle

KPIs:
  .itau-kpi-grid           .itau-kpi-card          .itau-kpi-label
  .itau-kpi-value          .itau-kpi-sub

Cards:
  .card / .itau-panel      .card-header            .card-body
  .itau-quick-grid         .itau-quick-card        .itau-quick-icon
  .itau-quick-title        .itau-quick-desc

Tabelas:
  .itau-table-wrap / .table-wrap
  .itau-table              thead th                tbody td

Formulários:
  .form-input              .form-select            .form-textarea
  .form-label              .itau-select

Botões:
  .btn-primary             .btn-secondary          .btn-ghost
  .btn-sm                  .btn-xs                 .itau-cta-btn

Badges:
  .badge
  .badge-brand  .badge-success  .badge-warning  .badge-danger
  .badge-info   .badge-purple   .badge-neutral  .badge-orange

Utilitários:
  .animate-fade-in         .scroll-block           .hidden
  .text-muted              .text-green
```

### Estrutura HTML padrão de cada componente (EJS)

**Layout base:**
```html
<div class="app-layout">
  <%- include('partials/sidebar', { user, activePage }) %>
  <%- include('partials/header',  { user, pageTitle }) %>
  <div class="itau-main-wrapper">
    <div class="page-header">
      <h1 class="page-title">Título</h1>
      <p class="page-subtitle">Subtítulo</p>
    </div>
    <!-- conteúdo -->
  </div>
</div>
```

**KPI Grid:**
```html
<div class="itau-kpi-grid">
  <div class="itau-kpi-card">
    <div style="display:flex;justify-content:space-between">
      <span class="itau-kpi-label">FATURAMENTO</span>
      <!-- svg icon -->
    </div>
    <div class="itau-kpi-value">R$ 123.456</div>
    <div class="itau-kpi-sub">42 vendas pagas</div>
  </div>
</div>
```

**Panel com tabela:**
```html
<div class="itau-panel" style="padding:0">
  <div class="card-header">
    <!-- svg icon -->
    <h3 class="itau-section-title" style="margin:0">Top Empresas</h3>
    <span style="margin-left:auto;font-size:11px;color:var(--text-3)">por faturamento</span>
  </div>
  <div class="itau-table-wrap">
    <table class="itau-table">
      <thead>
        <tr><th>#</th><th>Empresa</th><th style="text-align:right">Vendas</th><th style="text-align:right">Faturamento</th></tr>
      </thead>
      <tbody>
        <% topEmpresas.forEach((e, i) => { %>
          <tr>
            <td style="color:var(--text-4);width:32px"><%= i+1 %></td>
            <td style="font-weight:500"><%= e.label %></td>
            <td style="text-align:right"><%= e.qtd %></td>
            <td style="text-align:right;font-weight:600;color:var(--brand-dark)"><%= fmt(e.valor) %></td>
          </tr>
        <% }) %>
      </tbody>
    </table>
  </div>
</div>
```

**Filtro de período (botões toggle):**
```html
<div style="display:flex;gap:4px;background:var(--surface-2);border-radius:var(--radius-md);padding:3px">
  <% ["7d","30d","90d","12m","all","custom"].forEach(p => { %>
    <button onclick="setPeriod('<%= p %>')"
      class="period-btn <%= period === p ? 'active' : '' %>"
      data-period="<%= p %>">
      <%= {  "7d":"7 dias","30d":"30 dias","90d":"90 dias","12m":"12 meses","all":"Tudo","custom":"Período" }[p] %>
    </button>
  <% }) %>
</div>
```

### Breakpoints de responsividade

**Nenhum breakpoint explícito.** Portal é desktop-only. Grids usam `auto-fit`:
```css
.itau-kpi-grid  { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }
.itau-quick-grid { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
```

---

## RESUMO DA MIGRAÇÃO

| Item | Next.js (atual) | Express/EJS (destino) |
|------|----------------|----------------------|
| Routing | App Router automático | `express.Router()` manual |
| Data fetching | Server Components async | Controller functions no handler |
| Templates | JSX/TSX (React) | EJS (server-side) |
| Auth session | `@supabase/ssr` cookies auto | `supabase.auth.getUser()` + cookie manual |
| Middleware | `middleware.ts` Edge | Express middleware chain |
| Charts | Recharts (React) | **Chart.js v4** via CDN |
| Icons | lucide-react | SVG inline ou biblioteca JS |
| Cron | Vercel Crons | **node-cron** |
| Dark mode | React context (ThemeProvider) | `localStorage` + `html.dark` (JS puro) |
| Email convites | Resend SDK | Resend SDK (mesmo, compatível) |
| Supabase | `@supabase/ssr` | `@supabase/supabase-js` direto |
| Permissões | `can(role, permission)` TS | Mesmo sistema portado para JS |
| PDF export | jspdf + jspdf-autotable | Mesmo (compatível com Node) |

### Tabelas Supabase utilizadas

| Tabela | Uso |
|--------|-----|
| `usuarios` | Perfis, roles, avatar |
| `vendas` | Todas as transações (Airtable sync) |
| `vendas_colaboradores` | Mapeamento email→equipe→região |
| `empresas` | Cadastro de parceiros |
| `produtos` | Catálogo |
| `notas` | CRM / follow-ups |
| `feedbacks` | Feedback de clientes |
| `sugestoes` | Sugestões da equipe |
| `avisos` | Mural de comunicados |
| `configuracoes` | Power BI URL, nichos, permissões Lina |
| `convites` | Tokens de convite por email |
| `rh_colaboradores` | Dados pessoais de RH |
| `rh_advertencias` | Advertências de colaboradores |
| `rh_ferias` | Gestão de férias |
| `vendas_imports` | Controle de planilhas já importadas |
