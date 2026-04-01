# ROADMAP — Portal de Suporte Paytcall

> Atualizado em: 01/04/2026
> Status: 1–8, 12, 14, 15 concluídos. Em andamento: 16 (Importador Excel), 10 (Analytics).

---

## STATUS GERAL

| Item | Descrição | Status |
|---|---|---|
| 1 | Login & Roles (Admin, Suporte, Usuário, Terceiros) | ✅ Concluído |
| 2 | Tickets (Retenção/Logística, motivos, SLA, prioridades) | ✅ Concluído |
| 3 | Relatórios (Tickets + Cancelamentos) | ✅ Concluído |
| 4 | Notificações | ✅ Concluído |
| 5 | SLA com timer e semáforo | ✅ Concluído |
| 7 | Relatório de Tickets | ✅ Concluído |
| 8 | Rastreio em Atraso (1 dia / 3 dias) | ✅ Concluído |
| 9 | AI Agent / Chat (Lina — Gemini) | ✅ Concluído |
| 10 | Analytics/KPIs avançado | 🟡 Em andamento |
| 11 | UX/UI — refinamentos visuais | 🟡 Em andamento |
| 12 | Seleção múltipla + ações em lote (rastreios) | ✅ Concluído |
| 13 | Subdomínio / domínio definitivo | 🔲 Pendente |
| 14 | Paginação universal (por página + ir para página) | ✅ Concluído |
| 15 | Módulo Catálogo (Empresas, Produtos, Nichos, Feedbacks, Mídias) | ✅ Concluído |
| 16 | Importador Excel/Airtable para Vendas | 🟡 Em andamento |
| 17 | Log de auditoria global (Admin) — convites, imports, alterações | 🔲 Pendente |
| 18 | Barra de progresso no import de planilhas | 🔲 Pendente |
| 19 | Módulo Logística (mover /relatorios/logistica + renomear Relatórios) | 🔲 Pendente |

---

## 9 — AI AGENT / CHAT

### Status: ✅ IMPLEMENTADO — aguardando GEMINI_API_KEY no Railway

### O que foi feito
- [x] Rota `POST /api/ai/chat` com contexto dinâmico do banco
- [x] Widget flutuante (bottom-right) em todas as páginas
- [x] Histórico de conversa por sessão
- [x] Busca automática de pedido quando código é mencionado
- [x] Injeção de stats gerais em cada mensagem
- [x] Modelo: `gemini-1.5-flash`
- [x] System prompt em português como assistente Paytcall

### Para ativar
Adicionar no Railway: `GEMINI_API_KEY=AIzaSyD9lE5Juiqca9UZ5SwYCQ-mUKRzyuG6cN4`

### Próximas evoluções do agente — IDENTIDADE E CONFIGURAÇÕES
- [ ] **Nome e personalidade**: definir nome definitivo do agente (ex: "Payt IA", "Sora", "Flux")
- [ ] **Avatar personalizado**: foto/ilustração do agente
- [ ] **Tom de voz**: formal, amigável, técnico — definir com o time
- [ ] **Conhecimento expandido**: injetar FAQs, políticas de devolução, prazos SLA
- [ ] **Ações proativas**: agente sugere abrir ticket quando detecta problema
- [ ] **Acesso a cancelamentos**: injetar dados de chargeback/reembolso no contexto
- [ ] **Consulta de tickets ativos**: responder sobre SLA de tickets específicos
- [ ] **Memória persistente**: histórico de conversa salvo no banco por usuário
- [ ] **Escalação**: quando agente não souber, sugerir contato com equipe
- [ ] **Analytics via IA**: "quais produtos tiveram mais problemas este mês?"

---

## 10 — ANALYTICS / KPIs AVANÇADOS

### Status: Página base criada em `/analytics`
- [x] KPIs de taxa de entrega, pendência, devolução
- [x] Distribuição de status (donut)
- [x] Comparativo por transportadora
- [x] Produtos com mais pendências
- [x] Motivos de ticket mais frequentes

### Próximas métricas a adicionar
- [ ] **Mapa de estados** — quais UFs têm mais atrasos (requer campo address_state)
- [ ] **Evolução mensal** — curva de entregas por mês (últimos 6 meses)
- [ ] **Tempo médio de entrega** — dias entre paid_at e delivered
- [ ] **SLA de tickets** — tempo médio de resolução por tipo
- [ ] **Taxa de chargeback** — % de pedidos que viraram chargeback
- [ ] **Filtros temporais** — último 7 dias, 30 dias, 90 dias

---

## 11 — UX/UI PENDÊNCIAS

### Identidade visual
- [ ] Aplicar logo oficial da Payt (SVG fornecido) na sidebar e login
- [ ] Revisar cores no dark mode (alguns elementos ainda com baixo contraste)
- [ ] Adicionar favicon

### Funcionalidades UX
- [x] Botão copiar código de rastreio (inline na tabela)
- [x] Seleção múltipla na tabela de rastreios com bulk actions
- [ ] Busca global (Cmd+K) — busca por código, cliente, CPF, pedido
- [ ] Paginação infinita / scroll em vez de páginas numeradas
- [ ] Exportar tabela como CSV (rastreios, tickets, cancelamentos)
- [ ] Filtros salvos / favoritos

### Páginas pendentes de redesign com novo visual
- [x] Login
- [x] Dashboard principal
- [x] Rastreios
- [x] Analytics
- [ ] Detalhe do pedido (shipment.ejs) — refatorar para novo design
- [ ] Admin usuários / permissões

---

## 12 — MUDANÇA DE DOMÍNIO
- [ ] Alterar de `rastreios.paytcall.com.br` para `suporte.paytcall.com.br`
- [ ] Atualizar referências hardcoded no código
- [ ] Rota `/rastreios` já criada para não quebrar links existentes

---

## 2 — TICKETS (reestruturação completa)

### 2.0 — Tipos de ticket
- [ ] Criar campo `type`: **RETENÇÃO** | **LOGÍSTICA**
- [ ] Tipo obrigatório ao abrir ticket

### 2.1 — Campo MOTIVO (depende do tipo)

**Quando RETENÇÃO**, campo `motivo`:
- Cancelamento
- Desconto
- Devolução

**Quando RETENÇÃO + motivo "Cancelamento"**, campo `motivo_cancelamento`:
- Compra duplicada
- Não autorizou upsell/order bump
- Forma de pagamento incorreta
- Não sentiu efeito
- Alergia
- Valor
- Demora no envio
- Fraude
- Informação do rótulo
- Quantidade incorreta enviada
- Produto incorreto enviado
- Orientação médica
- Desistência
- Sem motivo
- Outros

**Quando LOGÍSTICA**, campo `motivo`:
- Reenvio
- Alteração de pedido
- Nota fiscal
- Envio

### 2.2 — Status (depende do tipo)

**RETENÇÃO**: Aberto → Em andamento → Cancelado | Retido
**LOGÍSTICA**: Aberto → Em andamento → Aguardando estoque → Concluído
> "Aguardando estoque" é **opcional** — pode ir direto de Aberto/Em andamento para Concluído

- [ ] Todo ticket novo entra como **"Aberto"**
- [ ] Validar: status permitidos por tipo (não permitir "Retido" em Logística, etc.)

### 2.3 — Atribuição automática
- [ ] Retenção → atribuir automaticamente a **Flaviany**
- [ ] Logística → atribuir automaticamente a **Shelida**
- [ ] Permitir reatribuição manual (Admin/Suporte)

### 2.4 — Campo Observação
- [ ] Caixa de texto livre no ticket para anotações

### 2.5 — Schema da tabela `tickets` (nova)
```
id               UUID PK
tracking_code    TEXT FK → shipments
order_id         TEXT
type             TEXT NOT NULL ('retencao' | 'logistica')
motivo           TEXT NOT NULL
motivo_cancelamento TEXT (só quando type=retencao E motivo=cancelamento)
status           TEXT NOT NULL DEFAULT 'aberto'
priority         INTEGER NOT NULL (1=Alta, 2=Média, 3=Baixa) — calculado automaticamente
assigned_to      TEXT NOT NULL (auto: Flaviany ou Shelida)
observation      TEXT
created_by       TEXT
created_at       TIMESTAMPTZ DEFAULT NOW()
updated_at       TIMESTAMPTZ DEFAULT NOW()
closed_at        TIMESTAMPTZ (preenchido quando status vira terminal)
```

---

## 5 — SLA (Service Level Agreement)

### 5.0 — Regra geral
- [ ] Todo ticket exibe: data/hora abertura + data/hora conclusão
- [ ] Se aberto: exibir **quantas horas** está em aberto
- [ ] Conclusão para **LOGÍSTICA** = status "Concluído"
- [ ] Conclusão para **RETENÇÃO** = status "Cancelado" ou "Retido"

### 5.1 — Prioridade automática por MOTIVO

**LOGÍSTICA:**
| Nível | Prioridade | Motivos |
|-------|-----------|---------|
| 1 | ALTA | Alteração de pedido, Envio |
| 2 | MÉDIA | Reenvio |
| 3 | BAIXA | Nota fiscal |

**RETENÇÃO (por motivo principal):**
| Nível | Prioridade | Motivo |
|-------|-----------|--------|
| 1 | ALTA | Cancelamento |
| 2 | MÉDIA | Desconto |
| 3 | BAIXA | Devolução |

### 5.2 — SLA definido
- [x] **72 horas** para todos os níveis de prioridade
- [ ] Prioridade serve para organização interna do responsável
- [ ] Exibir timer visual (verde < 48h, amarelo 48-72h, vermelho > 72h)
- [ ] Futuro: avaliar SLAs diferenciados por prioridade se necessário

---

## 7 — RELATÓRIO DE TICKETS

- [ ] Página separada `/relatorios/tickets`
- [ ] Colunas: ID Payt, Nome do cliente, CPF, Tipo (Retenção/Logística), Status, Motivo, Responsável, Prioridade, Tempo até conclusão
- [ ] Se ticket aberto: exibir horas em aberto
- [ ] Se ticket concluído: exibir tempo total até conclusão
- [ ] Filtros: tipo, status, motivo, responsável, prioridade, data

---

## 8 — ATUALIZAÇÃO AUTOMÁTICA DE STATUS DE RASTREIOS

- [ ] **1 dia após `paid_at`** sem código de rastreio → status = **"RASTREIO EM ATRASO"**
- [ ] **3 dias após `paid_at`** sem movimentação física (Objeto Postado, Em Trânsito, etc.) → status = **"RASTREIO EM ATRASO"** + **abre ticket automaticamente** (tipo Logística, motivo "Envio")
- [ ] Novo status `tracking_delayed` no sistema
- [ ] Verificação roda junto com o scheduler (08h/14h)

---

## 3 — RELATÓRIOS

### 3.0 — Relatório geral de tickets
- [ ] Página `/relatorios` com todos os tickets (Retenção + Logística)
- [ ] Filtros: tipo, status, empresa, responsável, data

### 3.1 — Relatório de CANCELAMENTOS E REEMBOLSOS
- [ ] Página separada `/relatorios/cancelamentos`
- [ ] Alimentado automaticamente pelos webhooks da Payt com status:
  - `chargeback_presented`
  - `chargeback`
  - `refunded`
  - `one_click_buy_refunded`
  - `refunded_partial`
  - `one_click_buy_refunded_partial`
  - ~~`peding_refund`~~ — NÃO entra
  - ~~`canceled`~~ — NÃO entra
- [ ] Coluna de Status de Pagamento com filtro
- [ ] Acesso limitado por roles (item 1)

#### Colunas do relatório REEMBOLSOS (baseado na planilha):
| Grupo | Coluna | Origem |
|-------|--------|--------|
| Controle | Data da solicitação | Manual / ticket |
| Controle | Data do reembolso | Manual |
| Controle | Status de atendimento | Dropdown: Sem contato, Sem retorno, Concluído, Aguardando retorno, Em contato, A contatar — **preenchido pelo responsável, sem impacto em SLA/prioridade** |
| Controle | Status de entrega | Auto (shipments.status mapeado) |
| Controle | Rastreio | Auto (shipments.tracking_code) |
| Controle | Pedido suspenso? | Dropdown: Sim, Não, Produto digital |
| Compra | Data da compra | Auto (Payt webhook) |
| Compra | ID da compra | Auto (order_id) |
| Compra | Plataforma | Auto (Payt Fly Now) |
| Compra | Cliente | Auto (customer_name) |
| Compra | CPF | Auto (customer_doc) |
| Compra | Produto | Auto (product_name) |
| Compra | Qtd | Auto (product_quantity) |
| Compra | Valor | Auto (total_price) |
| Compra | Motivo do cancelamento | Dropdown (mesmos do ticket retenção) |
| Compra | Obs | Texto livre |
| Logística Cancel. | Data | Manual |
| Logística Cancel. | ID - NF | Manual |
| Logística Cancel. | Status NF | Dropdown: Cancelada, Sem NF, Pendente, Sem alteração, Alterada |
| Logística Retido | Produto novo | Manual |
| Logística Retido | Qtd | Manual |
| Logística Retido | ID-nf | Manual |
| Logística Retido | Data | Manual |
| Logística Retido | Enviado? | Dropdown: Sim, Não |
| Devolução | Data da postagem | Manual |
| Devolução | Solicitado Reverso? | Dropdown: Sim, Não |
| Devolução | Rastreio reverso | Manual |
| Devolução | Status devolução | Dropdown (mesmos de Status de entrega) |

#### Colunas do relatório CHARGEBACKS (baseado na planilha):
| Grupo | Coluna | Origem |
|-------|--------|--------|
| Controle | Data atual | Auto (created_at) |
| Controle | Status de atendimento | Dropdown: Sem contato, Sem retorno, Concluído, Aguardando retorno, Em contato, A contatar — **preenchido pelo responsável** |
| Controle | Contestar até | Data limite |
| Controle | Status de entrega | Dropdown (mesmo do reembolsos) |
| Controle | Rastreio | Auto (tracking_code) |
| Controle | Pedido suspenso? | Dropdown: Sim, Não |
| Compra | Data da compra | Auto (Payt) |
| Compra | ID da compra | Auto (order_id) |
| Compra | Plataforma | Auto |
| Compra | Cliente | Auto |
| Compra | CPF | Auto |
| Compra | E-mail | Auto (customer_email) |
| Compra | Produto | Auto |
| Compra | Qtd | Auto |
| Compra | Valor | Auto |
| Compra | SRC (vendedora) | Auto (seller_email do webhook Payt) |
| Compra | Motivo do chargeback | Dropdown: Não autorizou o upsell, Compra duplicada, Desistência, Sem motivo, Não sentiu efeito, Alergia, Valor, Falta de estoque, Fraude (Cliente), Inf do rótulo, Qtd incorreta, Sem retorno, Insegurança, Demora no recebimento, Dados inválidos, Orientação Médica, Não autorizou Order Bump, Não reconhece |
| Compra | Obs | Texto livre |
| Logística | Data | Manual |
| Logística | ID - NF | Manual |
| Logística | Status NF | Dropdown (mesmo do reembolsos) |
| Devolução | Data da postagem | Manual |
| Devolução | Solicitado Reverso? | Dropdown: Sim, Não |
| Devolução | Rastreio reverso | Manual |
| Devolução | Status | Dropdown (mesmo de Status de entrega) |

---

## 4 — NOTIFICAÇÕES ✅

- [x] Ícone de sino (🔔) na barra superior com contador
- [x] Notificar o **criador** do ticket quando status mudar
- [x] Notificar o **responsável** do ticket quando novo ticket criado
- [x] Dropdown ao clicar no sino mostrando notificações recentes
- [x] Marcar todas como lidas
- [x] Clique na notificação leva ao pedido
- [x] Nome do usuário salvo no localStorage (temporário até Login ser implementado)

---

## 1 — LOGIN E CONVITES ✅

### 1.0 — Autenticação
- [x] Supabase Auth (email + senha)
- [x] Sistema de convite por link (Admin envia convite)
- [x] Tela de login

### 1.1 — Roles
| Role | Pedidos | Tickets | Relatórios | Config |
|------|---------|---------|-----------|--------|
| Admin | Todos | Abrir/Fechar/Editar + criar campos | Todos | Tudo |
| Suporte | Todos | Abrir/Fechar/Mudar status | Todos | — |
| Usuário | Todos | Abrir (não fechar) | Somente seus tickets | — |
| Terceiros | Só empresa dele | Abrir (não fechar) | Só empresa dele | — |

### 1.2 — Tabelas
```
users (Supabase Auth)
user_profiles (role, name, company_ids[])
user_company_access (user_id, seller_id) — para Terceiros
```

### 1.3 — Middleware
- [x] `requireAuth()` em todas as rotas
- [x] `requireRole(['admin','suporte'])` para fechar tickets
- [x] Terceiros: filtrar automaticamente por `seller_id`

---

---

## 9 — BACKUP E SEGURANÇA

### Situação atual:
| Componente | Backup? | Detalhes |
|-----------|---------|---------|
| Código-fonte | ✅ Seguro | GitHub (nathanmeireles1/paytcall-suporte) |
| Banco de dados | ✅ Seguro | Supabase PostgreSQL — backup automático diário (retenção 7 dias no free) |
| Variáveis de ambiente | ⚠️ Parcial | Salvas no Railway, mas sem backup externo |
| Dados locais (PC) | ⚠️ Risco | Antigravity corrompeu — sem impacto pois tudo está no GitHub + Supabase |

### Melhorias propostas:
- [ ] Exportar backup semanal do Supabase para Google Drive / S3 (via Edge Function ou cron)
- [ ] Documentar todas as variáveis de ambiente em `.env.example` (sem valores reais)
- [ ] Supabase Pro ($25/mês): aumenta retenção de backup para 30 dias + Point-in-Time Recovery

### Conclusão:
Seu portal **já está seguro** — código no GitHub, dados no Supabase. O que aconteceu com o Antigravity não afeta nada: era só o aplicativo desktop, não os seus projetos. Tudo foi restaurado com a reinstalação.

---

## 14 — PAGINAÇÃO UNIVERSAL ✅

- [x] Partial `partials/pagination.ejs` reutilizável em todas as views
- [x] Seletor "Por página" (25 / 50 / 100 / 200) — preserva filtros via `window.location`
- [x] Paginação com ellipsis inteligente (mostra 1, atual±2, último)
- [x] Campo "Ir para [___] de N páginas" com Enter para navegar
- [x] Aplicado em: dashboard, tickets, cancelamentos, logística, retenção/solicitacoes, rastreio-log
- [x] CSS: classes `.pagination-bar`, `.pagination-info`, `.pagination-controls`, `.pagination-goto`

---

## 15 — MÓDULO CATÁLOGO ✅ Concluído

- [x] Rota `/gestao/*` em `src/routes/gestao.js`
- [x] Página `/gestao/catalogo` com abas: Empresas | Produtos | Nichos
- [x] CRUD completo de Empresas e Produtos com modal design system
- [x] Detalhe de Empresa: informações + produtos vinculados + feedbacks (fix: campo `empresa` incluído na query de produtos)
- [x] Detalhe de Produto: informações + upload/delete de fotos e depoimentos + feedbacks
- [x] Sistema de Feedbacks (criar/editar/excluir) via partial `feedback-list.ejs`
- [x] Permissões: `canEdit` (admin ou role_permission) / `canDelete` (admin only)
- [x] Migração hub → operacional concluída
- [x] Fix 01/04: query de produtos incluía campos sem `empresa`, produtos não apareciam no detalhe da empresa

---

## 16 — IMPORTADOR EXCEL/AIRTABLE (VENDAS) 🔲 Pendente

### Contexto
- Dados recentes ficam no Airtable; quando chega perto de 120k linhas, usuário exporta para Excel e exclui do Airtable
- Os Excels ficam em uma pasta local
- Pacote `xlsx` já instalado no projeto

### Pendente
- [ ] Usuário fornecer nomes das colunas do Excel exportado do Airtable
- [ ] Criar rota de upload/import em `/gestao/vendas/import`
- [ ] Mapear colunas Excel → tabela hub `vendas` (ou equivalente)
- [ ] Interface de upload com preview antes de confirmar

---

## ITENS JÁ CONCLUÍDOS ✅

- [x] Webhook Payt → recebe pedidos pagos, chargebacks, reembolsos
- [x] Integração H7/Loggi via CPF (consulta de rastreio)
- [x] Scheduler 08h e 14h BRT
- [x] Dashboard com filtros (status, empresa, transportadora, produto, paid_at)
- [x] Detalhe do pedido (cliente, endereço, pagamento, timeline H7)
- [x] Paginação universal com por página + ir para (item 14)
- [x] Datas formatadas em horário Brasil
- [x] Endereço estruturado + CEP formatado
- [x] Tickets completos (LOGISTICA / RETENCAO, SLA, prioridades, motivos)
- [x] Correios (Wonca) como backup
- [x] Terminal statuses: delivered, returned
