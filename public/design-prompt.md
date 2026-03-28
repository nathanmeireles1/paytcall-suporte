# Paytcall Suporte — Design System & Style Guide

> Prompt para replicar o design deste portal em outros projetos da Paytcall.
> **URL:** `https://suporte.paytcall.com.br/`

---

## Identidade Visual

**Nome do produto:** Paytcall Suporte
**Tagline:** "Central de Suporte Paytcall — Rastreios, tickets e relatórios em um só lugar."
**Tom:** Profissional, direto, quente (warm). Paleta baseada em laranja queimado, fundos bege/off-white.

---

## Tipografia

| Uso | Família | Peso | Tamanho base |
|-----|---------|------|--------------|
| Títulos de página (h1) | **Calistoga** | 400 | 24–26px |
| Corpo / UI | **Plus Jakarta Sans** | 400, 500, 600, 700 | 14px (root) |
| Brand / logotipo sidebar | **Bebas Neue** | 400 | 17px |
| Código / rastreio | monospace (sistema) | — | 12–13px |

**Import Google Fonts:**
```html
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Bebas+Neue&family=Calistoga&display=swap" rel="stylesheet">
```

**Títulos de página:**
```css
.page-header h1,
.p-page-header-left h1 {
  font-family: 'Calistoga', serif;
  font-size: 26px;
  font-weight: 400;
  color: var(--text);
  letter-spacing: -0.01em;
  line-height: 1.1;
}
```

---

## Paleta de Cores

### Marca (Brand)
| Variável | Hex | Uso |
|----------|-----|-----|
| `--brand` | `#e47c24` | Cor primária, botões principais, ícones ativos |
| `--brand-dark` | `#884710` | Hover de botões, textos sobre fundo claro |
| `--brand-deeper` | `#763d0e` | Active state |
| `--brand-light` | `#fcc48c` | Badges, highlights suaves |
| `--brand-dim` | `rgba(228,124,36,.10)` | Fundo de itens ativos no nav |
| `--brand-border` | `rgba(228,124,36,.28)` | Bordas de componentes da marca |

### Superfícies (Light Mode)
| Variável | Hex | Uso |
|----------|-----|-----|
| `--bg` | `#faf8f5` | Background do body |
| `--bg-2` | `#ffffff` | Background da sidebar e topbar |
| `--surface` | `#ffffff` | Cards, modais |
| `--surface-2` | `#f7f3ee` | Inputs, hover states |
| `--surface-3` | `#ede8e0` | Chip backgrounds |

### Texto (Light Mode)
| Variável | Hex | Uso |
|----------|-----|-----|
| `--text` | `#1a1410` | Texto principal |
| `--text-2` | `#4a3f35` | Texto secundário |
| `--text-3` | `#8a7a6a` | Labels, placeholders |
| `--text-4` | `#b8aba0` | Disabled, muted |

### Bordas (Light Mode)
| Variável | Valor | Uso |
|----------|-------|-----|
| `--border` | `#e0d8cc` | Bordas de cards e inputs |
| `--border-2` | `#cfc5b4` | Bordas mais fortes |

### Dark Mode
| Variável | Hex | Mudança vs Light |
|----------|-----|-----------------|
| `--bg` | `#1c1c1e` | Fundo escuro principal |
| `--bg-2` | `#242426` | Sidebar e topbar |
| `--surface` | `#2c2c2e` | Cards |
| `--surface-2` | `#363638` | Inputs/hover |
| `--text` | `#f2f2f2` | Quase branco |
| `--text-2` | `#d0d0d0` | Secundário claro |
| `--text-3` | `#a0a0a0` | Terciário |
| `--text-4` | `#686868` | Muted |
| `--border` | `rgba(255,255,255,.13)` | Borda sutil |

### Semânticas
| Cor | Background | Border | Foreground |
|-----|-----------|--------|------------|
| Success (verde) | `#f0fdf4` | `#bbf7d0` | `#16a34a` |
| Warning (âmbar) | `#fefce8` | `#fde68a` | `#c2800a` |
| Danger (vermelho) | `#fef2f2` | `#fecaca` | `#dc2626` |
| Info (azul) | `#eff6ff` | `#bfdbfe` | `#2563eb` |
| Purple | `#f5f3ff` | `#ddd6fe` | `#7c3aed` |

---

## Layout

```
┌─────────────────────────────────────────────┐
│  Sidebar (220px fixo)  │  Main Area (flex:1) │
│                        │  ┌───────────────┐  │
│  [Brand Logo]          │  │ Topbar (52px) │  │
│  PAYTCALL              │  └───────────────┘  │
│  Suporte               │  ┌───────────────┐  │
│                        │  │ .page         │  │
│  [Nav items]           │  │  content here │  │
│                        │  └───────────────┘  │
│  [User footer + foto]  │                     │
└─────────────────────────────────────────────┘
```

**Variáveis de layout:**
- `--sidebar-w: 220px`
- `--topbar-h: 52px`
- `--radius: 5px`
- `--radius-md: 8px`
- `--radius-lg: 11px`

---

## Componentes Principais

### Sidebar
```css
.sidebar {
  width: var(--sidebar-w);
  background: var(--bg-2);
  border-right: 1px solid var(--border);
  position: fixed; top:0; left:0; bottom:0;
}
.sidebar-brand {
  height: var(--topbar-h);
  display: flex; align-items: center;
  padding: 0 16px; gap: 10px;
  border-bottom: 1px solid var(--border);
}
.brand-logo {
  width: 28px; height: 28px;
  background: var(--brand);
  border-radius: 7px;
  display: flex; align-items: center; justify-content: center;
}
.brand-name { font-family: 'Bebas Neue'; font-size: 17px; color: var(--text); }
.brand-tag  { font-size: 9px; color: var(--text-4); text-transform: uppercase; letter-spacing: .8px; }
```

**Seções da sidebar:**
- **Principal:** Dashboard, Rastreios, Tickets, Mural de Avisos (só admin)
- **Relatórios:** Análises, Retenção, Logística (visibilidade por permissão)
- **Administração:** Usuários, Permissões, Configurações (admin ou permissão específica)

**Nav items:**
```css
.nav-item {
  display: flex; align-items: center; gap: 9px;
  padding: 7px 10px; border-radius: 8px;
  color: var(--text-3); font-size: 13px; font-weight: 500;
}
.nav-item:hover { background: var(--surface-2); color: var(--text); }
.nav-item.active { background: var(--brand-dim); color: var(--brand-dark); font-weight: 600; }
html.dark .nav-item.active { color: var(--brand); }
```

**User footer com foto de perfil:**
```html
<!-- Avatar clicável para trocar foto -->
<div class="avatar avatar-clickable" onclick="document.getElementById('avatarInput').click()">
  <img src="..." id="avatarImg"> <!-- ou initial se sem foto -->
  <div class="avatar-overlay"> <!-- câmera icon, aparece no hover --> </div>
</div>
<input type="file" id="avatarInput" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="uploadAvatar(this)">
```
Upload via `POST /api/profile/photo` com base64. Salvo em Supabase Storage bucket `avatars`.

### Cards
```css
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg); /* 11px */
  box-shadow: var(--shadow-xs);
}
.card-header {
  padding: 12px 16px 11px;
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center; gap: 8px;
}
.card-header h3 { font-size: 13.5px; font-weight: 600; color: var(--text); }
.card-body { padding: 16px; }
```

### Botões
```css
/* Primary */
.btn-primary { background: var(--brand); color: #fff; border-radius: var(--radius); padding: 8px 14px; font-size: 13px; font-weight: 600; }
.btn-primary:hover { background: var(--brand-dark); }

/* Secondary */
.btn-secondary { background: var(--surface-2); color: var(--text-2); border: 1px solid var(--border); }

/* Ghost */
.btn-ghost { background: transparent; color: var(--text-2); border: 1px solid var(--border); }
.btn-ghost:hover { background: var(--surface-2); }

/* Sizes */
.btn-sm { padding: 5px 10px; font-size: 12px; }
.btn-xs { padding: 3px 7px; font-size: 11px; }
```

### Badges
```css
.badge {
  display: inline-flex; align-items: center;
  padding: 2px 7px; border-radius: 99px;
  font-size: 11px; font-weight: 600;
  border: 1px solid transparent;
}
/* Variantes: badge-brand, badge-success, badge-warning, badge-danger, badge-info, badge-neutral */
```

### Formulários
```css
.form-input, .form-select {
  width: 100%; padding: 8px 12px;
  border: 1px solid var(--border); border-radius: var(--radius-md);
  font-size: 13px; background: var(--surface); color: var(--text);
  font-family: var(--font);
}
.form-input:focus, .form-select:focus {
  outline: none; border-color: var(--brand);
  box-shadow: 0 0 0 3px var(--brand-dim);
}
.form-label { font-size: 12px; font-weight: 600; color: var(--text-2); margin-bottom: 5px; }
.form-textarea { resize: vertical; min-height: 80px; }
```

### Topbar
```css
.topbar {
  height: var(--topbar-h); background: var(--bg-2);
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center; padding: 0 22px; gap: 12px;
  position: sticky; top: 0; z-index: 50;
}
.topbar-breadcrumb { font-size: 11.5px; color: var(--text-4); }
.topbar-title { font-size: 14px; font-weight: 600; color: var(--text); }
```

### Tabelas
```css
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
thead th {
  padding: 9px 12px; text-align: left;
  font-size: 11px; font-weight: 700; color: var(--text-3);
  text-transform: uppercase; letter-spacing: .5px;
  background: var(--surface-2); border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
tbody td {
  padding: 9px 12px; border-bottom: 1px solid var(--border);
  color: var(--text-2);
}
tbody tr:hover td { background: var(--surface-2); }
tbody tr:last-child td { border-bottom: none; }
```

### Toast & Confirm (sistema custom — NUNCA usar alert/confirm nativos)
```js
// Toast — centered top, verde = success, vermelho = error, âmbar = warning
function showToast(msg, type='success') { /* ... */ }

// Confirm — overlay com botões Cancelar/Confirmar, retorna Promise<boolean>
function showConfirm(msg) { return new Promise(resolve => { /* ... */ }); }

// Uso:
const ok = await showConfirm('Tem certeza?');
if (!ok) return;
showToast('Ação realizada com sucesso.');
showToast('Erro ao processar.', 'error');
showToast('Atenção necessária.', 'warning');
```

**HTML do sistema:**
```html
<div id="toast" style="display:none;position:fixed;top:20px;left:50%;transform:translateX(-50%);color:#fff;padding:13px 22px;border-radius:10px;font-size:14px;font-weight:600;z-index:9999;box-shadow:0 6px 24px rgba(0,0,0,.22);min-width:220px;text-align:center;pointer-events:none"></div>
<div id="confirmOverlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9998;align-items:center;justify-content:center">
  <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px 24px;max-width:340px;width:90%">
    <p id="confirmMsg" style="font-size:14px;color:var(--text);margin-bottom:16px;line-height:1.5"></p>
    <div style="display:flex;justify-content:flex-end;gap:8px">
      <button onclick="confirmResolve(false)" class="btn btn-secondary btn-sm">Cancelar</button>
      <button onclick="confirmResolve(true)" class="btn btn-primary btn-sm">Confirmar</button>
    </div>
  </div>
</div>
```

### Bulk Actions (seleção em massa nas tabelas)
Padrão usado em Rastreios, Tickets e Logística:
```html
<!-- Barra de ação (aparece ao selecionar) -->
<div id="bulkBar" style="display:none;padding:10px 16px;background:var(--brand-dim);border:1px solid var(--brand-border);border-radius:8px;margin-bottom:12px;align-items:center;gap:10px">
  <span id="bulkCount" style="font-size:13px;font-weight:600;color:var(--brand-dark)">0 selecionados</span>
  <div style="margin-left:auto;display:flex;gap:6px">
    <button onclick="bulkAction('Concluído')" class="btn btn-primary btn-sm">Marcar Concluído</button>
    <button onclick="clearSel()" class="btn btn-ghost btn-sm">Cancelar</button>
  </div>
</div>

<!-- Thead com checkbox -->
<th style="width:36px;padding:9px 10px 9px 14px">
  <input type="checkbox" id="selAll" onchange="toggleAll(this)" style="width:14px;height:14px;accent-color:var(--brand);cursor:pointer">
</th>

<!-- Cada row com checkbox -->
<td style="padding:9px 10px 9px 14px" onclick="event.stopPropagation()">
  <input type="checkbox" class="row-chk" value="<%= item.id %>" onchange="updateBulk()" style="width:14px;height:14px;accent-color:var(--brand);cursor:pointer">
</td>
```

---

## Sombras
```css
--shadow-xs: 0 1px 2px rgba(0,0,0,.04);
--shadow-sm: 0 1px 3px rgba(0,0,0,.07), 0 1px 2px rgba(0,0,0,.04);
--shadow:    0 4px 8px rgba(0,0,0,.07), 0 1px 3px rgba(0,0,0,.05);
--shadow-md: 0 10px 20px rgba(0,0,0,.08), 0 4px 8px rgba(0,0,0,.05);
--shadow-lg: 0 20px 40px rgba(0,0,0,.1),  0 8px 16px rgba(0,0,0,.06);
```

---

## Dark Mode Toggle
```js
// Salvo em localStorage + classe no <html>
const saved = localStorage.getItem('theme');
if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
  document.documentElement.classList.add('dark');
}
function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
}
```

---

## Padrão de páginas

Toda página usa esta estrutura:
```html
<div class="app">
  <%- include('partials/sidebar', { activePage: 'nome-da-pagina' }) %>
  <div class="main">
    <%- include('partials/topbar', { pageTitle: 'Título', breadcrumb: [...] }) %>
    <div class="page">
      <!-- page-header opcional -->
      <div class="page-header">
        <h1>Título</h1>  <!-- Calistoga 26px -->
        <p>Subtítulo descritivo</p>
      </div>
      <!-- conteúdo em cards -->
      <div class="card">
        <div class="card-header"><h3>Seção</h3></div>
        <div class="card-body">...</div>
      </div>
    </div>
  </div>
</div>
```

---

## Animações
```css
/* Transições padrão */
transition: background .15s, color .15s, border-color .15s, box-shadow .15s;

/* Fade-in para modais */
@keyframes fadeInScale {
  from { opacity: 0; transform: scale(.95) translateY(8px); }
  to   { opacity: 1; transform: scale(1)   translateY(0);    }
}
.modal { animation: fadeInScale .18s ease; }

/* Spin para loading */
@keyframes spin { to { transform: rotate(360deg); } }
```

---

## Charts (Chart.js v4)

```js
// Configuração padrão (donut)
{
  type: 'doughnut',
  options: {
    cutout: '72%',
    plugins: { legend: { display: false }, tooltip: { enabled: true } },
    animation: { duration: 600 },
  }
}

// Configuração padrão (line)
{
  type: 'line',
  options: {
    responsive: true,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { display: false }, ticks: { color: '#8a7a6a', font: { size: 10 } } },
      y: { grid: { color: 'rgba(0,0,0,.05)' }, ticks: { color: '#8a7a6a', font: { size: 10 } } }
    },
    elements: { point: { radius: 3 }, line: { tension: 0.4, borderColor: '#e47c24', fill: true, backgroundColor: 'rgba(228,124,36,.1)' } }
  }
}
```

---

## Stack Técnica

| Camada | Tecnologia |
|--------|-----------|
| Runtime | Node.js 18+ |
| Framework | Express 4 |
| Template | EJS (server-side rendering) |
| Banco | Supabase (PostgreSQL) via `@supabase/supabase-js` |
| Auth | Cookie JWT, papéis: `admin`, `suporte`, `usuario`, `terceiros` |
| Permissões | Sistema granular por módulo (can_view/create/edit/delete), admin bypassa tudo |
| Charts | Chart.js v4.4.0 (CDN) |
| Fonts | Google Fonts CDN |
| AI | Google Gemini Flash via REST API (chat "Lina") |
| Deploy | Railway (auto-deploy via GitHub `nathanmeireles1/paytcall-suporte`) |
| Exports | `xlsx` npm package para Excel/CSV |

---

## Estrutura de Rotas

```
GET  /                              → Rastreios (lista)
GET  /rastreios                     → Rastreios (alias)
GET  /pedido/:orderId               → Detalhe do pedido (shipments + customer_queue)
GET  /shipment/:code                → Redirect 301 → /pedido/:orderId
GET  /dashboard                     → Dashboard/KPIs
GET  /analytics                     → Análises
GET  /relatorios/tickets            → Todos os tickets
GET  /relatorios/retencao           → Retenção (chargebacks/cancelamentos)
GET  /relatorios/logistica          → Logística (tickets de envio)
GET  /admin/users                   → Gestão de usuários
GET  /admin/permissions             → Gestão de permissões
GET  /admin/settings                → Configurações do sistema
GET  /admin/mural                   → Mural de Avisos (seção Principal, só admin)
GET  /login                         → Login
GET  /invite/:token                 → Aceite de convite

POST /shipment/:code/ticket         → Abre ticket (pedido com rastreio)
POST /pedido/:orderId/ticket        → Abre ticket (pedido sem rastreio / customer_queue)
POST /ticket/:id/status             → Altera status do ticket
POST /api/tickets/bulk              → Cria tickets em massa
POST /api/tickets/bulk-status       → Altera status de múltiplos tickets
POST /api/tracking/refresh          → Dispara atualização H7 manual
GET  /api/pedido/:orderId           → JSON para modal de detalhe
POST /api/profile/photo             → Upload de foto de perfil (todos os usuários)
```

---

## Modelo de Dados — Pedidos

O sistema é **pedido-first**: pedidos chegam via webhook na `customer_queue` sem rastreio ainda. Quando o H7 (scheduler) encontra um código de rastreio, o pedido é "promovido" para a tabela `shipments`.

```
customer_queue: order_id, seller_id, company_name, customer_name, customer_email,
                customer_doc, product_name, paid_at, shipping_address, ...
                (sem tracking_code)

shipments:      tracking_code, order_id, seller_id, company_name, customer_name,
                status, carrier, last_event, last_event_date, expected_date, ...
                (tem tracking_code)
```

`Shipment.findAllCombined()` une as duas tabelas para exibir todos os pedidos (com e sem rastreio).

**Tickets** podem ter `tracking_code` (pedido com rastreio) OU `order_id` (pedido sem rastreio ainda).

---

## Módulos de Permissão (role_permissions)

```
dashboard, tickets, relatorio_cancelamentos, relatorio_logistica,
admin_usuarios, admin_permissoes
```

Roles: `admin` (bypassa tudo), `suporte`, `usuario`, `terceiros`

---

## Paleta CSS completa (para copiar no :root)

```css
:root {
  --brand: #e47c24; --brand-dark: #884710; --brand-deeper: #763d0e;
  --brand-light: #fcc48c; --brand-warm: #dcccbc;
  --brand-dim: rgba(228,124,36,.1); --brand-dim2: rgba(228,124,36,.06);
  --brand-border: rgba(228,124,36,.28);

  --bg: #faf8f5; --bg-2: #ffffff;
  --surface: #ffffff; --surface-2: #f7f3ee; --surface-3: #ede8e0;
  --border: #e0d8cc; --border-2: #cfc5b4; --border-3: #bfb09a;
  --text: #1a1410; --text-2: #4a3f35; --text-3: #8a7a6a; --text-4: #b8aba0;

  --success: #16a34a; --success-bg: #f0fdf4; --success-border: #bbf7d0;
  --warning: #c2800a; --warning-bg: #fefce8; --warning-border: #fde68a;
  --danger: #dc2626; --danger-bg: #fef2f2; --danger-border: #fecaca;
  --info: #2563eb; --info-bg: #eff6ff; --info-border: #bfdbfe;
  --purple: #7c3aed; --purple-bg: #f5f3ff; --purple-border: #ddd6fe;

  --sidebar-w: 220px; --topbar-h: 52px;
  --radius: 5px; --radius-md: 8px; --radius-lg: 11px;
  --font: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
}
```
