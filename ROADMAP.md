# ROADMAP — Portal de Suporte Paytcall

> Atualizado em: 27/03/2026
> Ordem de execução: Itens 2 → 5 → 7 → 8 → 3 → 4 → 1 (Login por último)

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
| Controle | Status de atendimento | Dropdown: Reembolsado, Pendente, Retido desc., Retido - Refez Pagto, Retido troca, Devolução, Reemb./Suspenso, Em contato, Reemb. Parcial, Ag. Retorno |
| Controle | Status de entrega | Dropdown: Trânsito, Entregue, Retornou, Ag. retirada, Sem envio, Em devolução, Aguardando postagem, Envio suspenso, Etiqueta emitida, Etiqueta expirada, Postado, Tentativa de entrega |
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
| Controle | Status de atendimento | Dropdown: Contestação env, Retido > Refez o pg, Retido desc, Ag. resposta, Sem retorno, Dados inválidos, Devolução, Respondido, Chargeback Apresentado, Pendente, Em Contato, Não retido, Sem contato, Pen. reembolso, Reembolsado |
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
| Compra | SRC | Manual |
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

## 4 — NOTIFICAÇÕES

- [ ] Ícone de sino (🔔) na barra superior com contador
- [ ] Notificar o **criador** do ticket quando status mudar
- [ ] Notificar o **responsável** do ticket quando status mudar
- [ ] Tabela `notifications` no Supabase:
  ```
  id          UUID PK
  user_id     TEXT (nome ou ID do usuário)
  ticket_id   UUID FK → tickets
  message     TEXT
  read        BOOLEAN DEFAULT false
  created_at  TIMESTAMPTZ DEFAULT NOW()
  ```
- [ ] Dropdown ao clicar no sino mostrando notificações recentes
- [ ] Marcar como lida ao clicar

---

## 1 — LOGIN E CONVITES (ÚLTIMA TAREFA)

### 1.0 — Autenticação
- [ ] Supabase Auth (email + senha)
- [ ] Sistema de convite por link (Admin envia convite)
- [ ] Tela de login

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
- [ ] `requireAuth()` em todas as rotas
- [ ] `requireRole(['admin','suporte'])` para fechar tickets
- [ ] Terceiros: filtrar automaticamente por `seller_id`

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

## ITENS JÁ CONCLUÍDOS ✅

- [x] Webhook Payt → recebe pedidos pagos, chargebacks, reembolsos
- [x] Integração H7/Loggi via CPF (consulta de rastreio)
- [x] Scheduler 08h e 14h BRT
- [x] Dashboard com filtros (status, empresa, transportadora, produto, paid_at)
- [x] Detalhe do pedido (cliente, endereço, pagamento, timeline H7)
- [x] Paginação inteligente
- [x] Datas formatadas em horário Brasil
- [x] Endereço estruturado + CEP formatado
- [x] Tickets básicos (abrir/fechar) — será substituído pelo item 2
- [x] Correios (Wonca) como backup
- [x] Terminal statuses: delivered, returned (overdue removido)
